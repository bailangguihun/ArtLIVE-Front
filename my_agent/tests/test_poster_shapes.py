# coding: utf-8
"""Tests for poster layout shapes + compose pipeline."""

from __future__ import annotations

import io
import unittest

from PIL import Image

from poster_text_compose import (
    compose_text_on_bytes,
    default_shape,
    default_text_layout,
    normalize_shape,
    normalize_text_layout,
)


class PosterShapeComposeTests(unittest.TestCase):
    def test_normalize_keeps_shapes_separate_from_text_boxes(self) -> None:
        layout = default_text_layout({"title": "A", "headline": "B", "subline": "C"})
        layout["shapes"] = [
            default_shape("rect", shape_id="s1"),
            default_shape("line", shape_id="s2"),
            {"type": "ellipse", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.2},
        ]
        normalized = normalize_text_layout(layout)
        self.assertEqual(3, len(normalized["boxes"]))
        self.assertEqual(3, len(normalized["shapes"]))
        self.assertEqual("rect", normalized["shapes"][0]["type"])
        self.assertEqual("line", normalized["shapes"][1]["type"])
        self.assertEqual("ellipse", normalized["shapes"][2]["type"])
        self.assertEqual(0.0, normalized["shapes"][1]["fill_opacity"])

    def test_legacy_layout_without_shapes_defaults_empty(self) -> None:
        normalized = normalize_text_layout(
            {
                "title": "Hello",
                "headline": "World",
                "subline": "!",
            }
        )
        self.assertEqual([], normalized["shapes"])
        self.assertEqual(3, len(normalized["boxes"]))

    def test_normalize_shape_clamps_geometry(self) -> None:
        shape = normalize_shape(
            {
                "type": "rect",
                "x": 0.9,
                "y": 0.9,
                "w": 0.5,
                "h": 0.5,
                "fill_opacity": 2,
                "stroke_width": 99,
            },
            index=0,
        )
        self.assertLessEqual(shape["x"] + shape["w"], 1.0001)
        self.assertLessEqual(shape["y"] + shape["h"], 1.0001)
        self.assertEqual(1.0, shape["fill_opacity"])
        self.assertEqual(64, shape["stroke_width"])

    def test_compose_draws_shapes_and_keeps_size(self) -> None:
        base = Image.new("RGB", (320, 480), color=(30, 40, 50))
        buffer = io.BytesIO()
        base.save(buffer, format="PNG")
        base_png = buffer.getvalue()

        layout = default_text_layout(
            {"title": "标题", "headline": "卖点", "subline": "补充"}
        )
        layout["shapes"] = [
            {
                "id": "r1",
                "type": "rect",
                "x": 0.1,
                "y": 0.2,
                "w": 0.4,
                "h": 0.15,
                "fill": "#FF0000",
                "fill_opacity": 0.8,
                "stroke": "#00FF00",
                "stroke_width": 4,
                "stroke_opacity": 1.0,
            },
            {
                "id": "e1",
                "type": "ellipse",
                "x": 0.5,
                "y": 0.55,
                "w": 0.35,
                "h": 0.2,
                "fill": "#0000FF",
                "fill_opacity": 0.6,
                "stroke": "#FFFFFF",
                "stroke_width": 3,
                "stroke_opacity": 1.0,
            },
            {
                "id": "l1",
                "type": "line",
                "x": 0.1,
                "y": 0.1,
                "w": 0.7,
                "h": 0.05,
                "fill": "#FFFFFF",
                "fill_opacity": 0.0,
                "stroke": "#FFFF00",
                "stroke_width": 6,
                "stroke_opacity": 1.0,
            },
        ]
        composed = compose_text_on_bytes(base_png, layout)
        with Image.open(io.BytesIO(composed)) as image:
            image.load()
            self.assertEqual((320, 480), image.size)
            # Red fill from rectangle should appear somewhere in the mid-left band.
            sample = image.getpixel((int(320 * 0.25), int(480 * 0.27)))
            self.assertGreater(sample[0], sample[1])
            self.assertGreater(sample[0], sample[2])


if __name__ == "__main__":
    unittest.main()
