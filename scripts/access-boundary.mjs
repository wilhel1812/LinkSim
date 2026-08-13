#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_POLICY_ID = "32915afb-f399-4c5c-90ea-e5bf0f377b7c";
const AUTHENTICATED_POLICY_ID = "fd96072d-843b-4320-811a-281767b011ee";
const ACCOUNT_ID = "85c57e0c4da3a747a09212dc5b090f52";

export const ACCESS_BOUNDARIES = Object.freeze({
  staging: {
    configPath: "wrangler.staging.toml",
    rootUrl: "https://staging.linksim.link/",
    apiUrl: "https://staging.linksim.link/api/me",
    pagesRootUrl: "https://linksim-staging.pages.dev/",
    pagesRootRedirect: "https://staging.linksim.link/",
    acceptedAudiences: [
      "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
    ],
    applications: [
      {
        key: "shell",
        domain: "staging.linksim.link",
        policyId: PUBLIC_POLICY_ID,
        decision: "bypass",
        mutable: false,
      },
      {
        key: "api",
        domain: "staging.linksim.link/api/*",
        policyId: AUTHENTICATED_POLICY_ID,
        decision: "allow",
        audience: "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
        mutable: false,
      },
      {
        key: "pagesRoot",
        domain: "linksim-staging.pages.dev",
        policyId: PUBLIC_POLICY_ID,
        decision: "bypass",
        currentPolicyId: AUTHENTICATED_POLICY_ID,
        mutable: true,
      },
      {
        key: "preview",
        domain: "*.linksim-staging.pages.dev",
        policyId: AUTHENTICATED_POLICY_ID,
        decision: "allow",
        audience: "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
        mutable: false,
      },
    ],
  },
  production: {
    configPath: "wrangler.toml",
    rootUrl: "https://linksim.link/",
    apiUrl: "https://linksim.link/api/me",
    acceptedAudiences: [
      "ad63aaad91fb903f77154106fc69bb0fe7b845bfeb87ce09287b0c6dc92027b2",
    ],
    applications: [
      {
        key: "shell",
        domain: "linksim.link",
        policyId: PUBLIC_POLICY_ID,
        decision: "bypass",
        mutable: false,
      },
      {
        key: "api",
        domain: "linksim.link/api/*",
        policyId: AUTHENTICATED_POLICY_ID,
        decision: "allow",
        audience: "ad63aaad91fb903f77154106fc69bb0fe7b845bfeb87ce09287b0c6dc92027b2",
        mutable: false,
      },
    ],
  },
});

const normalizePolicyIds = (policies) =>
  [...new Set((policies ?? []).map((policy) => String(policy.id ?? "").trim()).filter(Boolean))]
    .sort();

const sameValues = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const validateAcceptedAudiences = (configured, expected) => {
  const actual = [...new Set(String(configured ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  assert(
    sameValues(actual, expected),
    `ACCESS_AUD must contain only the authenticated application audiences. Expected ${expected.join(",")}; received ${actual.join(",")}.`,
  );
  return actual;
};

export const parseAccessRedirectAudience = (location) => {
  let url;
  try {
    url = new URL(location);
  } catch {
    throw new Error("Expected a valid Cloudflare Access login redirect URL.");
  }
  const audience = url.searchParams.get("kid")?.trim() ?? "";
  assert(
    url.hostname.endsWith(".cloudflareaccess.com") && url.pathname.includes("/cdn-cgi/access/login/") && audience,
    "Expected a Cloudflare Access login redirect with an application audience.",
  );
  return audience;
};

export const validatePreviewUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Expected a valid staging preview URL.");
  }
  assert(url.protocol === "https:", "Staging preview URL must use HTTPS.");
  assert(
    /^[a-z0-9-]+\.linksim-staging\.pages\.dev$/i.test(url.hostname),
    `Unexpected staging preview hostname: ${url.hostname}.`,
  );
  return url;
};

export const verifyPreviewBoundary = async (value, boundary, fetchImpl = fetch) => {
  const url = validatePreviewUrl(value);
  const response = await fetchImpl(url, { redirect: "manual" });
  assert(response.status >= 300 && response.status < 400, `${url.href} must redirect to Access.`);
  const audience = parseAccessRedirectAudience(response.headers.get("location") ?? "");
  const expectedAudience = boundary.applications.find((application) => application.key === "preview")?.audience;
  assert(expectedAudience && audience === expectedAudience, `Unexpected preview Access audience for ${url.href}.`);
};

export const buildApplicationPolicyUpdate = (application, policyId) => {
  assert(application?.type === "self_hosted", "Only self-hosted Access applications may be updated.");
  const {
    id: _id,
    aud: _aud,
    created_at: _createdAt,
    updated_at: _updatedAt,
    policies: _policies,
    ...update
  } = application;
  update.policies = [{ id: policyId, precedence: 1 }];
  return update;
};

export const planAccessBoundary = (applications, boundary) => {
  const actions = [];
  const resolved = new Map();
  const policyDecisions = new Map();

  for (const application of applications) {
    for (const policy of application.policies ?? []) {
      const id = String(policy.id ?? "").trim();
      const decision = String(policy.decision ?? "").trim();
      if (!id || !decision) continue;
      const prior = policyDecisions.get(id);
      assert(!prior || prior === decision, `Policy ${id} has inconsistent decisions.`);
      policyDecisions.set(id, decision);
    }
  }

  for (const expected of boundary.applications) {
    const matches = applications.filter((application) => application.domain === expected.domain);
    assert(matches.length === 1, `Expected exactly one Access application for ${expected.domain}; found ${matches.length}.`);
    const application = matches[0];
    const actualPolicyIds = normalizePolicyIds(application.policies);
    const desiredPolicyIds = [expected.policyId];

    if (!sameValues(actualPolicyIds, desiredPolicyIds)) {
      assert(expected.mutable, `Access policy drift for ${expected.domain}: ${actualPolicyIds.join(",") || "none"}.`);
      const permittedCurrent = [expected.currentPolicyId].filter(Boolean).sort();
      assert(
        sameValues(actualPolicyIds, permittedCurrent),
        `Refusing unexpected Access policy transition for ${expected.domain}: ${actualPolicyIds.join(",") || "none"}.`,
      );
      actions.push({
        appId: application.id,
        domain: application.domain,
        fromPolicyIds: actualPolicyIds,
        toPolicyId: expected.policyId,
      });
    }

    if (expected.audience) {
      assert(application.aud === expected.audience, `Unexpected Access audience for ${expected.domain}.`);
    }
    resolved.set(expected.key, application);
  }

  for (const expected of boundary.applications) {
    const decision = policyDecisions.get(expected.policyId);
    assert(decision === expected.decision, `Policy ${expected.policyId} must be ${expected.decision}; found ${decision ?? "unknown"}.`);
  }

  return {
    actions,
    authenticatedAudiences: boundary.applications
      .map((expected) => expected.audience)
      .filter(Boolean),
    applications: resolved,
  };
};

const parseTomlString = (content, name) => {
  const match = content.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1] ?? "";
};

const cloudflareRequest = async (token, method, apiPath, body) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const errors = (payload.errors ?? []).map((error) => `${error.code}: ${error.message}`).join(", ");
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${errors || "unknown Cloudflare error"}`);
  }
  return payload.result;
};

const fetchApplications = async (token, boundary) => {
  const all = await cloudflareRequest(token, "GET", `/accounts/${ACCOUNT_ID}/access/apps?per_page=100`);
  const expectedDomains = new Set(boundary.applications.map((application) => application.domain));
  const matching = all.filter((application) => expectedDomains.has(application.domain));
  for (const application of matching) {
    application.policies = await cloudflareRequest(
      token,
      "GET",
      `/accounts/${ACCOUNT_ID}/access/apps/${application.id}/policies?per_page=100`,
    );
  }
  return matching;
};

const verifyHttpBoundary = async (boundary, { expectPagesRedirect = false } = {}) => {
  const rootResponse = await fetch(boundary.rootUrl, { redirect: "manual" });
  assert(rootResponse.status === 200, `${boundary.rootUrl} must return 200 anonymously; received ${rootResponse.status}.`);

  const apiResponse = await fetch(boundary.apiUrl, { redirect: "manual" });
  assert(apiResponse.status >= 300 && apiResponse.status < 400, `${boundary.apiUrl} must redirect to Access.`);
  const apiAudience = parseAccessRedirectAudience(apiResponse.headers.get("location") ?? "");
  assert(apiAudience === boundary.acceptedAudiences[0], `Unexpected API Access audience for ${boundary.apiUrl}.`);

  if (expectPagesRedirect && boundary.pagesRootUrl) {
    const pagesResponse = await fetch(boundary.pagesRootUrl, { redirect: "manual" });
    assert(
      [301, 302, 307, 308].includes(pagesResponse.status),
      `${boundary.pagesRootUrl} must redirect to the custom staging domain.`,
    );
    assert(
      pagesResponse.headers.get("location") === boundary.pagesRootRedirect,
      `Unexpected Pages-root redirect from ${boundary.pagesRootUrl}.`,
    );
  }
};

const run = async () => {
  const [mode, environment] = process.argv.slice(2);
  assert(
    ["plan", "apply", "check", "check-preview"].includes(mode),
    "Usage: access-boundary.mjs <plan|apply|check|check-preview> <staging|production>",
  );
  const boundary = ACCESS_BOUNDARIES[environment];
  assert(boundary, `Unknown Access environment: ${environment ?? ""}.`);
  assert(mode !== "apply" || environment === "staging", "Production Access mutation is not supported.");
  assert(mode !== "check-preview" || environment === "staging", "Preview verification is staging-only.");

  const configText = await readFile(path.resolve(process.cwd(), boundary.configPath), "utf8");
  validateAcceptedAudiences(parseTomlString(configText, "ACCESS_AUD"), boundary.acceptedAudiences);

  if (mode === "check-preview") {
    await verifyPreviewBoundary(process.env.ACCESS_PREVIEW_URL ?? "", boundary);
    console.log("[access-boundary] staging preview boundary verified.");
    return;
  }

  if (mode === "check") {
    await verifyHttpBoundary(boundary, { expectPagesRedirect: environment === "staging" });
    console.log(`[access-boundary] ${environment} boundary verified.`);
    return;
  }

  const token = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
  assert(token, "CLOUDFLARE_API_TOKEN is required for plan and apply modes.");

  let applications = await fetchApplications(token, boundary);
  let plan = planAccessBoundary(applications, boundary);
  console.log(`[access-boundary] ${environment} plan: ${plan.actions.length} policy update(s).`);
  for (const action of plan.actions) {
    console.log(`[access-boundary] ${action.domain}: ${action.fromPolicyIds.join(",")} -> ${action.toPolicyId}`);
  }

  if (mode === "plan") return;

  assert(plan.actions.length <= 1, "Refusing to apply more than one Access policy update.");
  for (const action of plan.actions) {
    const application = plan.applications.get("pagesRoot");
    assert(application?.id === action.appId, "Only the staging Pages-root application may be updated.");
    const applicationDetail = await cloudflareRequest(
      token,
      "GET",
      `/accounts/${ACCOUNT_ID}/access/apps/${application.id}`,
    );
    assert(applicationDetail.id === application.id, "Access application detail ID changed before mutation.");
    assert(applicationDetail.domain === application.domain, "Access application domain changed before mutation.");
    assert(applicationDetail.type === "self_hosted", "Access application type changed before mutation.");
    await cloudflareRequest(
      token,
      "PUT",
      `/accounts/${ACCOUNT_ID}/access/apps/${application.id}`,
      buildApplicationPolicyUpdate(applicationDetail, action.toPolicyId),
    );
  }

  applications = await fetchApplications(token, boundary);
  plan = planAccessBoundary(applications, boundary);
  assert(plan.actions.length === 0, "Staging Access reconciliation did not converge.");
  await verifyHttpBoundary(boundary, { expectPagesRedirect: true });
  console.log("[access-boundary] staging reconciliation and HTTP boundary verified.");
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`[access-boundary] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
