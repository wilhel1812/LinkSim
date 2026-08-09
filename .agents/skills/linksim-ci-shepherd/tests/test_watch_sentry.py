from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import io
import json
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


if __name__ == "__main__":
    unittest.main()
