const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

export function validatePreviewBranch(rawBranch) {
  const branch = String(rawBranch ?? "").trim();
  if (
    !SAFE_BRANCH.test(branch) ||
    branch === "main" ||
    branch === "staging" ||
    branch.startsWith("refs/") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".")
  ) {
    throw new Error(`Unsafe or reserved Pages preview branch: '${branch}'`);
  }
  return branch;
}

export function parsePagesDeploymentUrl(output, projectName) {
  const escapedProject = String(projectName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutAnsi = String(output).replace(/\u001b\[[0-9;]*m/g, "");
  const match = withoutAnsi.match(
    new RegExp(`https://[a-z0-9-]+\\.${escapedProject}\\.pages\\.dev(?:/[^\\s]*)?`, "i"),
  );
  if (!match) {
    throw new Error(`Pages deploy did not return an immutable ${projectName} deployment URL.`);
  }
  return match[0].replace(/[),.;]+$/, "");
}

export function hasMatchingPagesDeployment(output, { commit, branch, deploymentUrl = "" }) {
  const expectedCommit = String(commit ?? "").trim().toLowerCase();
  const expectedBranch = String(branch ?? "").trim();
  const expectedUrl = String(deploymentUrl ?? "").trim();
  if (expectedCommit.length < 7 || !expectedBranch) return false;

  const withoutAnsi = String(output).replace(/\u001b\[[0-9;]*m/g, "");
  return withoutAnsi.split("\n").some((line) => {
    if (!line.includes("│")) return false;
    const columns = line
      .split("│")
      .map((column) => column.trim())
      .filter(Boolean);
    const source = columns.find(
      (column) => /^[a-f0-9]{7,40}$/i.test(column) && expectedCommit.startsWith(column.toLowerCase()),
    );
    return (
      Boolean(source) &&
      columns.includes(expectedBranch) &&
      (!expectedUrl || columns.includes(expectedUrl))
    );
  });
}
