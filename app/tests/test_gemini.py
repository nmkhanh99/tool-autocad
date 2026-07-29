import subprocess
import unittest
from unittest.mock import MagicMock, patch

from acadtool.gemini import call_gemini, generate_lisp, normalize_lisp_response


class GeminiTests(unittest.TestCase):
    def test_markdown_lisp_fence_is_removed(self):
        response = "Giải pháp:\n```lisp\n(defun c:TEST () (princ))\n```"

        self.assertEqual(
            normalize_lisp_response(response),
            "(defun c:TEST () (princ))\n",
        )

    def test_multiple_code_blocks_are_rejected(self):
        response = "```lisp\n(princ 1)\n```\n```lisp\n(princ 2)\n```"

        with self.assertRaisesRegex(ValueError, "nhiều khối mã"):
            normalize_lisp_response(response)

    @patch("acadtool.gemini.find_agy_bin", return_value="/tmp/agy")
    @patch("acadtool.gemini.subprocess.run")
    def test_agy_uses_read_only_plan_sandbox(self, run, _find_agy_bin):
        run.return_value = subprocess.CompletedProcess(
            args=["agy"],
            returncode=0,
            stdout="ok",
            stderr="",
        )

        result = call_gemini("prompt", system_instruction="system")

        self.assertEqual(result, "ok")
        self.assertEqual(
            run.call_args.args[0],
            [
                "/tmp/agy",
                "--mode",
                "plan",
                "--sandbox",
                "-p",
                "system\n\nprompt",
            ],
        )
        self.assertNotIn("--dangerously-skip-permissions", run.call_args.args[0])

    @patch("acadtool.gemini.find_agy_bin", return_value=None)
    @patch("acadtool.gemini.urllib.request.urlopen")
    def test_rest_without_candidates_raises(self, urlopen, _find_agy_bin):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"candidates": []}'
        urlopen.return_value = response

        with self.assertRaisesRegex(RuntimeError, "không có candidates"):
            generate_lisp("test", api_key="key")

    @patch("acadtool.gemini.find_agy_bin", return_value=None)
    @patch("acadtool.gemini.urllib.request.urlopen")
    def test_rest_with_empty_text_raises(self, urlopen, _find_agy_bin):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = (
            b'{"candidates": [{"content": {"parts": [{"text": "   "}]}}]}'
        )
        urlopen.return_value = response

        with self.assertRaisesRegex(RuntimeError, "không phản hồi nội dung"):
            call_gemini("test", api_key="key")

    @patch("acadtool.gemini.find_agy_bin", return_value="/tmp/agy")
    @patch("acadtool.gemini.subprocess.run")
    def test_empty_cli_result_does_not_fall_through_to_rest_without_key(
        self,
        run,
        _find_agy_bin,
    ):
        run.return_value = subprocess.CompletedProcess(
            args=["agy"],
            returncode=1,
            stdout="",
            stderr="",
        )

        with self.assertRaisesRegex(RuntimeError, "exit code 1"):
            call_gemini("test")


if __name__ == "__main__":
    unittest.main()
