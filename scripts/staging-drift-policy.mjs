const asCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const normalizePullRequest = (pullRequest) => ({
  headRefName: pullRequest?.headRefName ?? pullRequest?.head?.ref ?? "",
  baseRefName: pullRequest?.baseRefName ?? pullRequest?.base?.ref ?? "",
  mergedAt: pullRequest?.mergedAt ?? pullRequest?.merged_at ?? null,
  htmlUrl: pullRequest?.url ?? pullRequest?.html_url ?? "",
});

export const isNormalStagingPromotion = (pullRequest) => {
  const normalized = normalizePullRequest(pullRequest);
  return normalized.baseRefName === "main" && normalized.headRefName === "staging" && Boolean(normalized.mergedAt);
};

export const shouldOpenStagingDriftIssue = ({ driftCount, associatedPullRequests }) => {
  const count = asCount(driftCount);
  if (count === 0) {
    return { openIssue: false, reason: "no ancestry drift detected" };
  }
  const pullRequests = Array.isArray(associatedPullRequests) ? associatedPullRequests : [];
  const stagingPromotion = pullRequests.map(normalizePullRequest).find(isNormalStagingPromotion);
  if (stagingPromotion) {
    return {
      openIssue: false,
      reason: `normal squash-merged staging->main promotion: ${stagingPromotion.htmlUrl || "associated PR"}`,
    };
  }
  return { openIssue: true, reason: `${count} main commit(s) are not represented by a staging promotion PR` };
};

const writeGitHubOutput = async (entries) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(entries).map(([key, value]) => `${key}=${value}`);
  if (!outputPath) {
    console.log(lines.join("\n"));
    return;
  }
  const { appendFileSync } = await import("node:fs");
  appendFileSync(outputPath, `${lines.join("\n")}\n`);
};

const fetchAssociatedPullRequests = async ({ token, repository, sha }) => {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} while reading associated PRs`);
  }
  return response.json();
};

export const runCli = async () => {
  const driftCount = process.env.DRIFT_COUNT ?? "0";
  const token = process.env.GITHUB_TOKEN ?? "";
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const sha = process.env.GITHUB_SHA ?? "";
  if (!token || !repository || !sha) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_SHA are required");
  }

  const associatedPullRequests = await fetchAssociatedPullRequests({ token, repository, sha });
  const result = shouldOpenStagingDriftIssue({ driftCount, associatedPullRequests });
  await writeGitHubOutput({
    open_issue: result.openIssue ? "true" : "false",
    reason: result.reason,
  });
  console.log(`[staging-drift-policy] ${result.openIssue ? "open issue" : "skip issue"}: ${result.reason}`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
