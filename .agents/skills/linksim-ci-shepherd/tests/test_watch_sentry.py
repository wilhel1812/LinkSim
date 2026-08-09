from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "watch-sentry"
SPEC = importlib.util.spec_from_loader(
    "watch_sentry", SourceFileLoader("watch_sentry", str(SCRIPT))
)
assert SPEC and SPEC.loader
watch_sentry = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = watch_sentry
SPEC.loader.exec_module(watch_sentry)


class WatchSentryTest(unittest.TestCase):
    def run_main(self, *arguments: str):
        output = io.StringIO()
        with redirect_stdout(output):
            code = watch_sentry.main(list(arguments))
        return code, json.loads(output.getvalue())

    def test_passes_only_for_completed_exact_head(self):
        head = "a" * 40
        with (
            patch.object(watch_sentry, "read_pr_head", side_effect=[head, head]),
            patch.object(
                watch_sentry,
                "read_review_status",
                return_value={
                    "target": "pr:42",
                    "revision": head,
                    "state": "completed",
                    "terminal_reason": "shadow-review-stored",
                },
            ) as status,
        ):
            code, result = self.run_main(
                "42", "--repo", "wilhel1812/LinkSim", "--host", "operator@example"
            )

        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "pass")
        self.assertEqual(result["head_sha"], head)
        status.assert_called_once_with("operator@example", 42, head)

    def test_fails_closed_for_terminal_review_failure(self):
        head = "b" * 40
        with (
            patch.object(watch_sentry, "read_pr_head", return_value=head),
            patch.object(
                watch_sentry,
                "read_review_status",
                return_value={
                    "target": "pr:42",
                    "revision": head,
                    "state": "needs-human",
                    "terminal_reason": "provider-retry-exhausted",
                },
            ),
        ):
            code, result = self.run_main("42", "--host", "operator@example")

        self.assertEqual(code, 1)
        self.assertEqual(result["result"], "needs-human")
        self.assertEqual(result["terminal_reason"], "provider-retry-exhausted")

    def test_fails_when_pr_head_changes_after_review(self):
        reviewed = "c" * 40
        current = "d" * 40
        with (
            patch.object(watch_sentry, "read_pr_head", side_effect=[reviewed, current]),
            patch.object(
                watch_sentry,
                "read_review_status",
                return_value={"target": "pr:42", "revision": reviewed, "state": "completed"},
            ),
        ):
            code, result = self.run_main("42", "--host", "operator@example")

        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "head-changed")
        self.assertEqual(result["head_sha"], reviewed)
        self.assertEqual(result["current_head_sha"], current)

    def test_rejects_completed_status_for_wrong_or_missing_exact_identity(self):
        head = "e" * 40
        invalid_statuses = [
            {"target": "pr:41", "revision": head, "state": "completed"},
            {"target": "pr:42", "revision": "f" * 40, "state": "completed"},
            {"target": "pr:42", "state": "completed"},
        ]
        for status in invalid_statuses:
            with self.subTest(status=status):
                with (
                    patch.object(watch_sentry, "read_pr_head", return_value=head),
                    patch.object(watch_sentry, "read_review_status", return_value=status),
                ):
                    code, result = self.run_main("42", "--host", "operator@example")

                self.assertEqual(code, 2)
                self.assertEqual(result["result"], "error")

    def test_converts_process_start_and_timeout_failures_to_final_error(self):
        head = "a" * 40
        errors = [
            FileNotFoundError("ssh not found"),
            subprocess.TimeoutExpired(["ssh"], 30),
        ]
        for error in errors:
            with self.subTest(error=type(error).__name__):
                with (
                    patch.object(watch_sentry, "read_pr_head", return_value=head),
                    patch.object(watch_sentry, "read_review_status", side_effect=error),
                ):
                    code, result = self.run_main("42", "--host", "operator@example")

                self.assertEqual(code, 2)
                self.assertEqual(result["result"], "error")

    def test_external_processes_have_bounded_timeouts(self):
        completed = subprocess.CompletedProcess([], 0, stdout="a" * 40, stderr="")
        with patch.object(watch_sentry.subprocess, "run", return_value=completed) as run:
            watch_sentry.read_pr_head(42, "wilhel1812/LinkSim")
        self.assertEqual(run.call_args.kwargs["timeout"], 30)

        completed = subprocess.CompletedProcess(
            [],
            0,
            stdout=json.dumps(
                {"target": "pr:42", "revision": "a" * 40, "state": "completed"}
            ),
            stderr="",
        )
        with patch.object(watch_sentry.subprocess, "run", return_value=completed) as run:
            watch_sentry.read_review_status("operator@example", 42, "a" * 40)
        self.assertEqual(run.call_args.kwargs["timeout"], 30)


if __name__ == "__main__":
    unittest.main()
