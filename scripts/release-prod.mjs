#!/usr/bin/env node

console.error(
  [
    "[release:prod] This local production release script is intentionally disabled.",
    "Production releases must use the protected PR + CI flow:",
    "1. Prepare release notes/version on chore/release-X-Y-Z and merge to staging.",
    "2. Verify staging deployment.",
    "3. Promote with a PR from staging to main, or release/vX.Y.Z to main if direct promotion conflicts.",
    "4. Let CI deploy production after protected-branch checks and approvals pass.",
    "Do not push directly to main or run production deploys locally.",
  ].join("\n"),
);
process.exit(1);
