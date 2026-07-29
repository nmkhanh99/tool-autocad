import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from acadtool import dwgjson
from acadtool.model import (
    DrawingReadError,
    _read_drawing_libredwg,
    read_drawing,
)


class PolylineLengthTests(unittest.TestCase):
    def test_closed_lwpolyline_includes_closing_segment(self):
        data = {
            "OBJECTS": [{
                "entity": "LWPOLYLINE",
                "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
                "flag": 512,
            }],
        }

        with patch("acadtool.model.dwg_to_json", return_value=data):
            drawing = _read_drawing_libredwg("closed.dwg")

        self.assertAlmostEqual(drawing.pipes[0].length, 40.0)

    def test_lwpolyline_bulge_uses_arc_length(self):
        data = {
            "OBJECTS": [{
                "entity": "LWPOLYLINE",
                "points": [[0, 0], [10, 0]],
                "bulges": [1.0, 0.0],
            }],
        }

        with patch("acadtool.model.dwg_to_json", return_value=data):
            drawing = _read_drawing_libredwg("arc.dwg")

        self.assertAlmostEqual(drawing.pipes[0].length, math.pi * 5.0)

    def test_libredwg_closed_flag_includes_closing_bulge(self):
        data = {
            "OBJECTS": [{
                "entity": "LWPOLYLINE",
                "points": [[-0.25, 0.0], [0.25, 0.0]],
                "bulges": [1.0, 1.0],
                "flag": 532,
            }],
        }

        with patch("acadtool.model.dwg_to_json", return_value=data):
            drawing = _read_drawing_libredwg("closed-bulge.dwg")

        self.assertAlmostEqual(drawing.pipes[0].length, math.pi * 0.5)

    def test_libredwg_extrusion_flag_does_not_close_polyline(self):
        data = {
            "OBJECTS": [{
                "entity": "LWPOLYLINE",
                "points": [[0.0, 0.0], [3.0, 0.0], [3.0, 4.0]],
                "flag": 1,
            }],
        }

        with patch("acadtool.model.dwg_to_json", return_value=data):
            drawing = _read_drawing_libredwg("open-extruded.dwg")

        self.assertAlmostEqual(drawing.pipes[0].length, 7.0)


class DrawingReadErrorTests(unittest.TestCase):
    def test_corrupt_cached_json_is_normalized_and_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dwg = root / "bad-cache.dwg"
            dwg.write_bytes(b"fixture")

            with patch.object(dwgjson, "CACHE_DIR", root / "cache"):
                cache = dwgjson._cache_path(dwg)
                cache.parent.mkdir(parents=True)
                cache.write_text("{", encoding="latin-1")

                with self.assertRaises(DrawingReadError) as caught:
                    read_drawing(dwg)

                self.assertIsInstance(caught.exception.__cause__, dwgjson.DwgReadError)
                self.assertFalse(cache.exists())


if __name__ == "__main__":
    unittest.main()
