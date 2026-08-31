from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from PIL import Image


class ArtifactNotFoundError(FileNotFoundError):
    pass


class ArtifactValidationError(ValueError):
    """Safe structural failure for an unfinished artifact group."""


class ArtifactStore:
    """Owns all new generation paths and validates every externally supplied ID."""

    def __init__(self, root: Path, max_image_pixels: int = 40_000_000):
        self.root = root.resolve()
        self.max_image_pixels = int(max_image_pixels)
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _validated_uuid(value: str) -> str:
        try:
            parsed = uuid.UUID(str(value))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ArtifactNotFoundError("artifact not found") from exc
        normalized = str(parsed)
        if normalized != str(value).lower():
            raise ArtifactNotFoundError("artifact not found")
        return normalized

    def _generation_dir(self, generation_id: str) -> Path:
        valid = self._validated_uuid(generation_id)
        candidate = (self.root / valid).resolve()
        if candidate.parent != self.root:
            raise ArtifactNotFoundError("artifact not found")
        return candidate

    def create_generation(self) -> str:
        generation_id = str(uuid.uuid4())
        directory = self._generation_dir(generation_id)
        directory.mkdir(parents=False, exist_ok=False)
        return generation_id

    def discard_generation(self, generation_id: str) -> None:
        """Remove only files created inside one exact, validated, unfinished generation."""
        directory = self._generation_dir(generation_id)
        if not directory.is_dir():
            return
        for child in directory.iterdir():
            resolved = child.resolve()
            if resolved.parent != directory or not resolved.is_file():
                raise RuntimeError("unexpected artifact entry")
            resolved.unlink()
        directory.rmdir()

    @staticmethod
    def _atomic_write_bytes(path: Path, data: bytes) -> None:
        # Windows can briefly lock a just-written manifest (AV / indexer / concurrent
        # readers). Retry replace so sequence tasks do not die on WinError 5/32.
        last_error: Optional[BaseException] = None
        for attempt in range(12):
            temporary_name = ""
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb", dir=str(path.parent), prefix=".pending-", delete=False
                ) as handle:
                    temporary_name = handle.name
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_name, path)
                temporary_name = ""
                return
            except PermissionError as exc:
                last_error = exc
            except OSError as exc:
                winerror = getattr(exc, "winerror", None)
                if winerror not in {5, 32}:
                    raise
                last_error = exc
            finally:
                if temporary_name and os.path.exists(temporary_name):
                    try:
                        os.unlink(temporary_name)
                    except OSError:
                        pass
            time.sleep(0.05 * (attempt + 1))
        assert last_error is not None
        raise last_error

    def save_poster(
        self,
        generation_id: str,
        image: Image.Image,
        variant_index: int,
        background_source: str,
        fallback_used: bool,
    ) -> Dict[str, Any]:
        directory = self._generation_dir(generation_id)
        if not directory.is_dir():
            raise ArtifactNotFoundError("generation not found")
        poster_id = str(uuid.uuid4())
        file_name = f"poster-{variant_index + 1:02d}-{poster_id}.png"
        target = directory / file_name
        buffer = tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024)
        try:
            image.convert("RGB").save(buffer, format="PNG", optimize=True)
            buffer.seek(0)
            self._atomic_write_bytes(target, buffer.read())
        finally:
            buffer.close()
        return {
            "poster_id": poster_id,
            "variant_index": int(variant_index),
            "width": int(image.width),
            "height": int(image.height),
            "background_source": str(background_source),
            "fallback_used": bool(fallback_used),
            "file_name": file_name,
        }

    @staticmethod
    def _pixel_fingerprint(image: Image.Image) -> bytes:
        normalized = image.convert("RGBA")
        return hashlib.sha256(
            normalized.mode.encode("ascii")
            + str(normalized.size).encode("ascii")
            + normalized.tobytes()
        ).digest()

    def save_complete_poster_group(
        self,
        generation_id: str,
        images: Iterable[Image.Image],
        *,
        poster_source: str = "seedream_complete_poster",
    ) -> List[Dict[str, Any]]:
        """Persist three complete provider posters without resizing or compositing."""
        group = list(images)
        if len(group) != 3:
            raise ArtifactValidationError("complete poster group must contain three images")
        dimensions = []
        fingerprints = []
        for image in group:
            if not isinstance(image, Image.Image):
                raise ArtifactValidationError("complete poster group contains an invalid image")
            image.load()
            width, height = image.size
            if (
                width <= 0
                or height <= 0
                or width * height > self.max_image_pixels
            ):
                raise ArtifactValidationError("complete poster dimensions are invalid")
            dimensions.append((width, height))
            fingerprints.append(self._pixel_fingerprint(image))
        if len(set(dimensions)) != 1:
            raise ArtifactValidationError("complete poster dimensions are inconsistent")
        if len(set(fingerprints)) != 3:
            raise ArtifactValidationError("complete poster group contains duplicate images")

        directory = self._generation_dir(generation_id)
        if not directory.is_dir():
            raise ArtifactNotFoundError("generation not found")
        records: List[Dict[str, Any]] = []
        for variant_index, image in enumerate(group):
            poster_id = str(uuid.uuid4())
            file_name = f"poster-{variant_index + 1:02d}-{poster_id}.png"
            target = (directory / file_name).resolve()
            if target.parent != directory:
                raise ArtifactValidationError("complete poster path is invalid")
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
            self._atomic_write_bytes(target, output.getvalue())
            records.append(
                {
                    "poster_id": poster_id,
                    "variant_index": variant_index,
                    "width": int(image.width),
                    "height": int(image.height),
                    "background_source": poster_source,
                    "poster_source": poster_source,
                    "fallback_used": False,
                    "product_sent_to_provider": True,
                    "local_product_compositing": False,
                    "local_text_rendering": False,
                    "file_name": file_name,
                }
            )
        return records

    def save_sequence_poster(
        self,
        generation_id: str,
        image: Image.Image,
        poster_index: int,
        *,
        existing_posters: Iterable[Dict[str, Any]] = (),
    ) -> Dict[str, Any]:
        """Atomically persist one provider-rendered poster without cropping."""

        if poster_index not in (1, 2, 3) or not isinstance(image, Image.Image):
            raise ArtifactValidationError("sequence poster is invalid")
        image.load()
        width, height = image.size
        if width <= 0 or height <= 0 or width * height > self.max_image_pixels:
            raise ArtifactValidationError("sequence poster dimensions are invalid")

        directory = self._generation_dir(generation_id)
        if not directory.is_dir():
            raise ArtifactNotFoundError("generation not found")
        file_name = f"poster-{poster_index:02d}.png"
        target = (directory / file_name).resolve()
        if target.parent != directory or target.exists():
            raise ArtifactValidationError("sequence poster path is invalid")

        output = io.BytesIO()
        normalized = (
            image
            if image.mode in {"1", "L", "LA", "P", "RGB", "RGBA", "I", "I;16"}
            else image.convert("RGB")
        )
        normalized.save(output, format="PNG", optimize=True)
        encoded = output.getvalue()
        encoded_hash = hashlib.sha256(encoded).hexdigest()
        for record in existing_posters:
            prior = (directory / str(record.get("file_name") or "")).resolve()
            if prior.parent != directory or not prior.is_file():
                raise ArtifactValidationError("existing sequence poster path is invalid")
            if hashlib.sha256(prior.read_bytes()).hexdigest() == encoded_hash:
                raise ArtifactValidationError("sequence poster duplicates an earlier poster")

        self._atomic_write_bytes(target, encoded)
        return {
            "poster_id": str(uuid.uuid4()),
            "variant_index": poster_index - 1,
            "index": poster_index,
            "width": int(width),
            "height": int(height),
            "background_source": "seedream_complete_poster",
            "poster_source": "seedream_complete_poster",
            "fallback_used": False,
            "product_sent_to_provider": True,
            "local_product_compositing": False,
            "local_text_rendering": False,
            "file_name": file_name,
            "file_sha256": encoded_hash,
        }

    def create_zip(self, generation_id: str, posters: Iterable[Dict[str, Any]]) -> str:
        directory = self._generation_dir(generation_id)
        file_name = f"generation-{generation_id}.zip"
        target = directory / file_name
        temporary_name = ""
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=str(directory), prefix=".pending-", delete=False
            ) as handle:
                temporary_name = handle.name
            with zipfile.ZipFile(temporary_name, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
                for index, poster in enumerate(posters, start=1):
                    source = (directory / str(poster["file_name"])).resolve()
                    if source.parent != directory or not source.is_file():
                        raise ArtifactNotFoundError("poster not found")
                    archive.write(source, arcname=f"poster-{index:02d}.png")
            os.replace(temporary_name, target)
        finally:
            if temporary_name and os.path.exists(temporary_name):
                os.unlink(temporary_name)
        return file_name

    def validate_complete_poster_group(
        self,
        generation_id: str,
        posters: Iterable[Dict[str, Any]],
        zip_file_name: str,
    ) -> Dict[str, Any]:
        """Return structural QA facts without exposing server paths."""
        records = list(posters)
        if len(records) != 3:
            raise ArtifactValidationError("stored poster group must contain three images")
        directory = self._generation_dir(generation_id)
        dimensions = []
        file_hashes = []
        expected_zip_entries = [f"poster-{index:02d}.png" for index in range(1, 4)]
        for record in records:
            candidate = (directory / str(record.get("file_name") or "")).resolve()
            if candidate.parent != directory or not candidate.is_file():
                raise ArtifactValidationError("stored poster path is invalid")
            data = candidate.read_bytes()
            file_hashes.append(hashlib.sha256(data).hexdigest())
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    dimensions.append((int(image.width), int(image.height)))
            except (OSError, ValueError) as exc:
                raise ArtifactValidationError("stored poster is invalid") from exc
        if len(set(file_hashes)) != 3:
            raise ArtifactValidationError("stored poster files are not distinct")
        if len(set(dimensions)) != 1:
            raise ArtifactValidationError("stored poster dimensions are inconsistent")

        archive_path = (directory / zip_file_name).resolve()
        if archive_path.parent != directory or not archive_path.is_file():
            raise ArtifactValidationError("poster archive path is invalid")
        try:
            with zipfile.ZipFile(archive_path, mode="r") as archive:
                names = archive.namelist()
                if names != expected_zip_entries:
                    raise ArtifactValidationError("poster archive entries are invalid")
                for name in names:
                    with archive.open(name, mode="r") as entry:
                        with Image.open(io.BytesIO(entry.read())) as image:
                            image.load()
        except ArtifactValidationError:
            raise
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            raise ArtifactValidationError("poster archive is invalid") from exc
        return {
            "poster_count": 3,
            "dimensions": [list(item) for item in dimensions],
            "dimensions_consistent": True,
            "files_distinct": True,
            "paths_contained": True,
            "zip_entry_count": 3,
            "zip_entries_expected": True,
        }

    def validate_sequence_artifacts(
        self,
        generation_id: str,
        posters: Iterable[Dict[str, Any]],
        zip_file_name: str,
    ) -> Dict[str, Any]:
        """Validate three serially stored originals without resizing or cropping."""

        records = list(posters)
        if len(records) != 3:
            raise ArtifactValidationError("sequence must contain three posters")
        directory = self._generation_dir(generation_id)
        dimensions: List[List[int]] = []
        hashes: List[str] = []
        for expected_index, record in enumerate(records, start=1):
            if int(record.get("index", 0)) != expected_index:
                raise ArtifactValidationError("sequence poster order is invalid")
            candidate = (directory / str(record.get("file_name") or "")).resolve()
            if candidate.parent != directory or not candidate.is_file():
                raise ArtifactValidationError("sequence poster path is invalid")
            data = candidate.read_bytes()
            hashes.append(hashlib.sha256(data).hexdigest())
            try:
                with Image.open(io.BytesIO(data)) as decoded:
                    decoded.load()
                    dimensions.append([int(decoded.width), int(decoded.height)])
            except (OSError, ValueError) as exc:
                raise ArtifactValidationError("sequence poster is invalid") from exc
        if len(set(hashes)) != 3:
            raise ArtifactValidationError("sequence posters are not distinct")

        archive_path = (directory / zip_file_name).resolve()
        expected_names = [f"poster-{index:02d}.png" for index in range(1, 4)]
        if archive_path.parent != directory or not archive_path.is_file():
            raise ArtifactValidationError("sequence archive path is invalid")
        try:
            with zipfile.ZipFile(archive_path, mode="r") as archive:
                if archive.namelist() != expected_names:
                    raise ArtifactValidationError("sequence archive entries are invalid")
                for name in expected_names:
                    with archive.open(name, mode="r") as entry:
                        with Image.open(io.BytesIO(entry.read())) as decoded:
                            decoded.load()
        except ArtifactValidationError:
            raise
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            raise ArtifactValidationError("sequence archive is invalid") from exc
        return {
            "poster_count": 3,
            "dimensions": dimensions,
            "dimensions_consistent": len({tuple(item) for item in dimensions}) == 1,
            "files_distinct": True,
            "paths_contained": True,
            "zip_entry_count": 3,
            "zip_entries_expected": True,
        }

    def write_manifest(self, generation_id: str, manifest: Dict[str, Any]) -> None:
        directory = self._generation_dir(generation_id)
        data = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._atomic_write_bytes(directory / "manifest.json", data)

    def read_manifest(self, generation_id: str) -> Dict[str, Any]:
        path = self._generation_dir(generation_id) / "manifest.json"
        if not path.is_file():
            raise ArtifactNotFoundError("generation not found")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ArtifactNotFoundError("generation not found") from exc
        if not isinstance(value, dict):
            raise ArtifactNotFoundError("generation not found")
        return value

    def iter_manifests(self) -> Iterable[Dict[str, Any]]:
        """Yield valid local manifests without following unexpected links."""

        if not self.root.is_dir():
            return
        for child in self.root.iterdir():
            if child.is_symlink() or not child.is_dir():
                continue
            try:
                generation_id = self._validated_uuid(child.name)
                if self._generation_dir(generation_id) != child.resolve():
                    continue
                yield self.read_manifest(generation_id)
            except (ArtifactNotFoundError, OSError, ValueError):
                continue

    def resolve_poster(self, generation_id: str, poster_id: str) -> Path:
        valid_poster_id = self._validated_uuid(poster_id)
        manifest = self.read_manifest(generation_id)
        for poster in manifest.get("posters") or []:
            if poster.get("poster_id") == valid_poster_id:
                directory = self._generation_dir(generation_id)
                candidate = (directory / str(poster.get("file_name") or "")).resolve()
                if candidate.parent == directory and candidate.is_file():
                    return candidate
        raise ArtifactNotFoundError("poster not found")

    def resolve_zip(self, generation_id: str) -> Path:
        manifest = self.read_manifest(generation_id)
        file_name = str(manifest.get("zip_file_name") or "")
        directory = self._generation_dir(generation_id)
        candidate = (directory / file_name).resolve()
        if not file_name or candidate.parent != directory or not candidate.is_file():
            raise ArtifactNotFoundError("archive not found")
        return candidate
