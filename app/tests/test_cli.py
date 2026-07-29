import contextlib
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cli
from acadtool.model import Drawing, DrawingReadError


def empty_drawing(path: str) -> Drawing:
    return Drawing(
        path=Path(path),
        layers=[],
        inserts=[],
        texts=[],
        pipes=[],
        layer_usage={},
    )


class BatchReadTests(unittest.TestCase):
    @patch("cli.read_drawing")
    def test_bad_drawing_does_not_abort_remaining_batch(self, read_drawing):
        read_drawing.side_effect = [
            DrawingReadError("hỏng"),
            empty_drawing("good.dwg"),
        ]

        with contextlib.redirect_stderr(io.StringIO()):
            drawings = cli._read_all([Path("bad.dwg"), Path("good.dwg")])

        self.assertEqual([drawing.path.name for drawing in drawings], ["good.dwg"])


class GeminiJsonTests(unittest.TestCase):
    def test_json_mode_keeps_stdout_as_jsonl(self):
        args = SimpleNamespace(
            gemini_cmd="analyze",
            paths=["drawing.dwg"],
            prompt="",
            key=None,
            model=None,
            json=True,
        )
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            patch("cli._collect", return_value=[Path("drawing.dwg")]),
            patch("cli.read_drawing", return_value=empty_drawing("drawing.dwg")),
            patch("cli.analyze_drawings", return_value="ok"),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            result = cli.cmd_gemini(args)

        events = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(result, 0)
        self.assertEqual(events, [{"type": "text", "data": "ok"}, {"type": "end"}])
        self.assertIn("✓ drawing.dwg", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
