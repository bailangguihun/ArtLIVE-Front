from __future__ import annotations

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from my_agent.backend.domain.models import GenerationCommand
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.storage.artifact_store import ArtifactNotFoundError, ArtifactStore
from my_agent.poster_generator import render_poster_variant
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeSeedreamProvider,
    FakeStockProvider,
    png_bytes,
)


class ProductAndArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = ArtifactStore(self.root / "artifacts")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def product() -> Image.Image:
        product = Image.new("RGBA", (48, 58), (0, 0, 0, 0))
        opaque = Image.new("RGBA", (38, 48), (223, 18, 42, 255))
        product.paste(opaque, (5, 5), opaque)
        return product

    def test_every_product_type_is_final_local_layer(self) -> None:
        for product_type in ("bag_heavy", "bottle_upright", "flat_small"):
            with self.subTest(product_type=product_type):
                poster, metadata = render_poster_variant(
                    Image.new("RGBA", (180, 240), (80, 120, 170, 255)),
                    self.product(),
                    "Product",
                    "Local text",
                    "Safe subline",
                    "vibrant",
                    product_type,
                    1,
                )
                self.assertEqual((180, 240), poster.size)
                self.assertTrue(metadata["final_local_product_paste"])
                self.assertTrue(metadata["local_text_rendering"])
                self.assertFalse(metadata["product_sent_to_provider"])
                transformed = metadata["scaled_product"]
                x, y = metadata["product_xy"]
                center = (x + transformed.width // 2, y + transformed.height // 2)
                self.assertEqual((223, 18, 42), poster.getpixel(center)[:3])

    def test_flat_small_retains_rotation_and_final_paste(self) -> None:
        poster, metadata = render_poster_variant(
            Image.new("RGBA", (180, 240), "white"),
            self.product(),
            "Product",
            "Headline",
            "",
            "premium",
            "flat_small",
            0,
        )
        self.assertEqual(-22, metadata["rotation_degrees"])
        self.assertTrue(metadata["final_local_product_paste"])
        self.assertEqual("flat_small", metadata["product_type"])
        self.assertEqual((180, 240), poster.size)

    def test_three_variants_reuse_one_remote_background(self) -> None:
        provider = FakeSeedreamProvider(configured=True)
        service = GenerationService(
            FakeCopyClient(),
            ImageGenerationService(
                provider,
                FakeStockProvider(configured=False),
            ),
            self.store,
        )
        command = GenerationCommand(
            product_info="Product",
            product_short_name="Product",
            creative_note="",
            visual_style="vibrant",
            generate_poster=True,
            background_mode="seedream_text",
            output_size="512x768",
            product_type="flat_small",
            product_image=png_bytes(transparent_border=True),
        )
        with patch.dict(
            "my_agent.backend.services.generation_service.OUTPUT_SIZES",
            {"512x768": (144, 192)},
            clear=False,
        ):
            result = service.generate(command, "offline-request")
        self.assertEqual(3, len(result.posters))
        self.assertEqual(1, provider.calls)
        self.assertEqual([None], provider.references)
        self.assertTrue(all(item.background_source == "seedream" for item in result.posters))
        manifest = self.store.read_manifest(result.generation_id)
        self.assertTrue(
            all(item["final_local_product_paste"] for item in manifest["posters"])
        )
        self.assertTrue(all(item["local_text_rendering"] for item in manifest["posters"]))
        self.assertFalse(any(item["product_sent_to_provider"] for item in manifest["posters"]))

    def test_artifact_ids_resolve_and_zip_contains_only_server_files(self) -> None:
        generation_id = self.store.create_generation()
        record = self.store.save_poster(
            generation_id,
            Image.new("RGBA", (40, 60), "blue"),
            0,
            "procedural",
            False,
        )
        zip_name = self.store.create_zip(generation_id, [record])
        manifest = {
            "generation_id": generation_id,
            "posters": [record],
            "zip_file_name": zip_name,
        }
        self.store.write_manifest(generation_id, manifest)
        self.assertTrue(
            self.store.resolve_poster(generation_id, record["poster_id"]).is_file()
        )
        self.assertTrue(self.store.resolve_zip(generation_id).is_file())

    def test_arbitrary_paths_and_ids_cannot_resolve(self) -> None:
        invalid_values = ("..", "/absolute/path", "not-a-uuid", str(uuid.uuid4()) + "/x")
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(ArtifactNotFoundError):
                    self.store.resolve_poster(value, value)

    def test_failed_generation_discard_does_not_delete_existing_outputs(self) -> None:
        preserved = self.root / "completed-poster.png"
        preserved.write_bytes(b"preserve-me")
        generation_id = self.store.create_generation()
        generation_dir = self.store.root / generation_id
        (generation_dir / "temporary-owned-file").write_bytes(b"temporary")
        self.store.discard_generation(generation_id)
        self.assertEqual(b"preserve-me", preserved.read_bytes())
        self.assertFalse(generation_dir.exists())

    def test_manifest_is_valid_utf8_json_without_image_payloads(self) -> None:
        generation_id = self.store.create_generation()
        self.store.write_manifest(
            generation_id,
            {"generation_id": generation_id, "posters": [], "warnings": ["安全提示"]},
        )
        manifest_path = self.store.root / generation_id / "manifest.json"
        text = manifest_path.read_text(encoding="utf-8")
        self.assertIn("安全提示", text)
        self.assertNotIn("base64", text.lower())
        self.assertNotIn("authorization", text.lower())

    def test_uploaded_filename_is_never_persisted(self) -> None:
        generation_id = self.store.create_generation()
        record = self.store.save_poster(
            generation_id,
            Image.new("RGB", (20, 30), "white"),
            0,
            "procedural",
            False,
        )
        self.assertNotIn("user-upload", record["file_name"])
        self.assertRegex(record["file_name"], r"^poster-01-[0-9a-f-]+\.png$")


if __name__ == "__main__":
    unittest.main()
