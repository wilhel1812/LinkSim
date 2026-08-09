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
        with (
            patch.dict(watch_sentry.os.environ, {"LINKSIM_SENTRY_HOST": "operator@example"}),
            redirect_stdout(output),
        ):
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
                    "terminal_reason": "native-shadow-review-stored",
                    "engine_version": "codex-native-v2",
                    "verdict": "clean",
                    "finding_count": 0,
                },
            ) as status,
        ):
            code, result = self.run_main(
                "42", "--repo", "wilhel1812/LinkSim", "--host", "operator@example"
            )

        self.assertEqual(code, 0)
        self.assertEqual(result["result"], "pass")
        self.assertEqual(result["head_sha"], head)
        status.assert_called_once_with(
            "operator@example", 42, head, timeout_seconds=30
        )

    def test_fails_closed_when_native_review_has_findings(self):
        head = "9" * 40
        with (
            patch.object(watch_sentry, "read_pr_head", return_value=head),
            patch.object(
                watch_sentry,
                "read_review_status",
                return_value={
                    "target": "pr:42",
                    "revision": head,
                    "state": "completed",
                    "terminal_reason": "native-shadow-review-stored",
                    "engine_version": "codex-native-v2",
                    "verdict": "non-blocking-findings",
                    "finding_count": 1,
                },
            ),
        ):
            code, result = self.run_main("42", "--host", "operator@example")

        self.assertEqual(code, 1)
        self.assertEqual(result["result"], "needs-human")
        self.assertEqual(result["finding_count"], 1)
        self.assertEqual(result["review_verdict"], "non-blocking-findings")

    def test_rejects_legacy_or_incomplete_completed_review_contract(self):
        head = "8" * 40
        invalid_statuses = [
            {
                "target": "pr:42", "revision": head, "state": "completed",
                "engine_version": "legacy-one-shot-v1", "verdict": "clean", "finding_count": 0,
            },
            {
                "target": "pr:42", "revision": head, "state": "completed",
                "engine_version": "codex-native-v2", "finding_count": 0,
            },
            {
                "target": "pr:42", "revision": head, "state": "completed",
                "engine_version": "codex-native-v2", "verdict": "clean", "finding_count": 1,
            },
        ]
        for status in invalid_statuses:
            with self.subTest(status=status):
                with (
                    patch.object(watch_sentry, "read_pr_head", return_value=head),
                    patch.object(watch_sentry, "read_review_status", return_value=status),
                ):
                    code, result = self.run_main("42", "--host", "operator@example")
                self.assertNotEqual(code, 0)
                self.assertNotEqual(result["result"], "pass")

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
                return_value={
                    "target": "pr:42",
                    "revision": reviewed,
                    "state": "completed",
                    "engine_version": "codex-native-v2",
                    "verdict": "clean",
                    "finding_count": 0,
                },
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
        self.assertEqual(run.call_args.args[0][0:3], ["ssh", "--", "operator@example"])

    def test_rejects_host_outside_the_configured_allowlist(self):
        with (
            patch.dict(
                watch_sentry.os.environ,
                {"LINKSIM_SENTRY_HOST": "operator@example"},
            ),
            patch.object(watch_sentry, "read_pr_head") as read_head,
        ):
            output = io.StringIO()
            with redirect_stdout(output):
                code = watch_sentry.main(["42", "--host=-oProxyCommand=unsafe"])

        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["result"], "error")
        read_head.assert_not_called()

    def test_overall_timeout_caps_the_poll_sleep(self):
        head = "a" * 40

        class Clock:
            now = 0.0
            sleeps = []

            def monotonic(self):
                return self.now

            def sleep(self, seconds):
                self.sleeps.append(seconds)
                self.now += seconds

        clock = Clock()
        with (
            patch.object(watch_sentry, "read_pr_head", return_value=head),
            patch.object(
                watch_sentry,
                "read_review_status",
                return_value={"target": "pr:42", "revision": head, "state": "missing"},
            ),
            patch.object(watch_sentry.time, "monotonic", side_effect=clock.monotonic),
            patch.object(watch_sentry.time, "sleep", side_effect=clock.sleep),
        ):
            code, result = self.run_main(
                "42", "--host", "operator@example", "--timeout", "1", "--interval", "15"
            )

        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "timeout")
        self.assertEqual(clock.sleeps, [1.0])

    def test_rejects_non_hexadecimal_head_sha_before_status_query(self):
        valid_head = "a" * 40
        invalid_head = "g" * 40
        with (
            patch.object(watch_sentry, "read_pr_head", return_value=valid_head),
            patch.object(watch_sentry, "read_review_status") as read_status,
        ):
            code, result = self.run_main(
                "42", "--host", "operator@example", "--head-sha", invalid_head
            )

        self.assertEqual(code, 2)
        self.assertEqual(result["result"], "error")
        read_status.assert_not_called()

    def test_rejects_non_hexadecimal_github_head(self):
        completed = subprocess.CompletedProcess([], 0, stdout="g" * 40, stderr="")
        with patch.object(watch_sentry.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(ValueError, "invalid PR head SHA"):
                watch_sentry.read_pr_head(42, "wilhel1812/LinkSim")


if __name__ == "__main__":
    unittest.main()
