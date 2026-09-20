#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_POLICY_ID = "32915afb-f399-4c5c-90ea-e5bf0f377b7c";
const PUBLIC_API_POLICY_ID = "d0a1003c-ce29-4f14-a635-58463e82020b";
const AUTHENTICATED_POLICY_ID = "fd96072d-843b-4320-811a-281767b011ee";
const ACCOUNT_ID = "85c57e0c4da3a747a09212dc5b090f52";

export const ACCESS_BOUNDARIES = Object.freeze({
  staging: {
    configPath: "wrangler.staging.toml",
    strictHost: "staging.linksim.link",
    rootUrl: "https://staging.linksim.link/",
    originProbeUrl: "https://staging.linksim.link/api/health",
    apiUrl: "https://staging.linksim.link/api/me",
    apiAuthMode: "application",
    legacyMigrationUrl: "https://staging.linksim.link/api/auth/legacy-access/session",
    authBootstrapUrl: "https://staging.linksim.link/api/auth/passkey/generate-authenticate-options",
    authManagementUrl: "https://staging.linksim.link/api/auth/passkey/list-user-passkeys",
    pagesRootUrl: "https://linksim-staging.pages.dev/",
    pagesRootRedirect: "https://staging.linksim.link/",
    acceptedAudiences: [
      "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
    ],
    applications: [
      {
        key: "shell",
        appId: "de019d23-db41-410d-8d33-b61bb2d86beb",
        domain: "staging.linksim.link",
        policyId: PUBLIC_POLICY_ID,
        decision: "bypass",
        mutable: false,
      },
      {
        key: "publicApi",
        appId: "3b76dae4-589d-47bb-b69c-f6dcfabd7169",
        name: "LinkSim Staging Application API",
        domain: "staging.linksim.link/api/*",
        destinationUris: [
          "staging.linksim.link/api/*",
          "staging.linksim.link/copernicus/*",
        ],
        policyId: PUBLIC_API_POLICY_ID,
        decision: "bypass",
        mutable: true,
        currentName: "LinkSim Staging Public API Exceptions",
        currentDomain: "staging.linksim.link/api/v1/calculate*",
        currentDestinationUris: [
          "staging.linksim.link/api/v1/calculate*",
          "staging.linksim.link/copernicus/*",
          "staging.linksim.link/api/public-simulation*",
          "staging.linksim.link/api/auth/*",
        ],
        currentPolicyId: PUBLIC_API_POLICY_ID,
      },
      {
        key: "api",
        appId: "7db960b9-188b-4735-b84e-1ee672b60703",
        name: "LinkSim Staging Legacy Migration API",
        domain: "staging.linksim.link/api/auth/legacy-access/*",
        destinationUris: ["staging.linksim.link/api/auth/legacy-access/*"],
        policyId: AUTHENTICATED_POLICY_ID,
        decision: "allow",
        audience: "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
        mutable: true,
        currentName: "LinkSim Staging Authenticated API",
        currentDomain: "staging.linksim.link/api/*",
        currentDestinationUris: [],
        currentPolicyId: AUTHENTICATED_POLICY_ID,
      },
      {
        key: "pagesRoot",
        domain: "linksim-staging.pages.dev",
        policyId: PUBLIC_POLICY_ID,
        decision: "bypass",
        mutable: false,
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
    apiAuthMode: "access",
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

export const STAGING_ACCESS_ROLLBACK_BOUNDARY = Object.freeze({
  ...ACCESS_BOUNDARIES.staging,
  apiAuthMode: "access",
  legacyMigrationUrl: undefined,
  authBootstrapUrl: undefined,
  authManagementUrl: undefined,
  applications: ACCESS_BOUNDARIES.staging.applications.map((application) => {
    if (!application.mutable) return application;
    return {
      ...application,
      name: application.currentName,
      domain: application.currentDomain,
      destinationUris: application.currentDestinationUris,
      policyId: application.currentPolicyId,
      currentName: application.name,
      currentDomain: application.domain,
      currentDestinationUris: application.destinationUris,
      currentPolicyId: application.policyId,
    };
  }),
});

const normalizePolicyIds = (policies) =>
  [...new Set((policies ?? []).map((policy) => String(policy.id ?? "").trim()).filter(Boolean))]
    .sort();

const normalizeDestinationUris = (destinations) =>
  [...new Set((destinations ?? []).map((destination) => String(destination.uri ?? "").trim()).filter(Boolean))]
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

export const buildApplicationUpdate = (application, desired) => {
  const update = buildApplicationPolicyUpdate(application, desired.policyId);
  update.name = desired.name;
  update.domain = desired.domain;
  if (desired.destinationUris.length > 0) {
    update.destinations = desired.destinationUris.map((uri) => ({ type: "public", uri }));
  } else {
    delete update.destinations;
  }
  return update;
};

export const orderAccessActions = (actions, rollback) => {
  const order = rollback ? ["publicApi", "api"] : ["api", "publicApi"];
  return [...actions].sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key));
};

const destinationHost = (value) => String(value ?? "").trim().toLowerCase().split("/")[0];

const hostPatternMatches = (pattern, host) => {
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return false;
};

export const selectBoundaryApplications = (applications, boundary) => {
  const expectedIds = new Set(boundary.applications.map((application) => application.appId).filter(Boolean));
  const expectedDomains = new Set(boundary.applications.flatMap((application) =>
    [application.domain, application.currentDomain].filter(Boolean)));
  return applications.filter((application) => {
    if (expectedIds.has(application.id) || expectedDomains.has(application.domain)) return true;
    const destinations = [application.domain, ...normalizeDestinationUris(application.destinations)];
    if (destinations.some((uri) => expectedDomains.has(uri))) return true;
    return Boolean(boundary.strictHost && destinations.some((uri) =>
      hostPatternMatches(destinationHost(uri), boundary.strictHost)));
  });
};

const matchesApplicationState = (application, expected, prefix = "") => {
  const current = prefix === "current";
  const name = current ? expected.currentName : expected.name;
  const domain = current ? expected.currentDomain : expected.domain;
  const destinationUris = current ? expected.currentDestinationUris : expected.destinationUris;
  const policyId = current ? expected.currentPolicyId : expected.policyId;
  return (!name || application.name === name)
    && application.domain === domain
    && (destinationUris === undefined || sameValues(
      normalizeDestinationUris(application.destinations),
      [...destinationUris].sort(),
    ))
    && sameValues(normalizePolicyIds(application.policies), [policyId]);
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
    const matches = applications.filter((application) => expected.appId
      ? application.id === expected.appId
      : [expected.domain, expected.currentDomain].filter(Boolean).includes(application.domain));
    const identity = expected.appId ?? expected.domain;
    assert(matches.length === 1, `Expected exactly one Access application for ${identity}; found ${matches.length}.`);
    const application = matches[0];
    const desired = matchesApplicationState(application, expected);
    if (!desired) {
      assert(expected.mutable, `Access boundary drift for ${identity}.`);
      const current = matchesApplicationState(application, expected, "current");
      assert(current, `Access destination drift or unexpected transition for ${identity}.`);
      actions.push({
        key: expected.key,
        appId: application.id,
        fromDomain: application.domain,
        toDomain: expected.domain,
        fromPolicyIds: normalizePolicyIds(application.policies),
        toPolicyId: expected.policyId,
      });
    }

    if (expected.audience) {
      assert(application.aud === expected.audience, `Unexpected Access audience for ${expected.domain}.`);
    }
    if (!expected.mutable && expected.destinationUris) {
      const actualDestinationUris = normalizeDestinationUris(application.destinations);
      const expectedDestinationUris = [...expected.destinationUris].sort();
      assert(
        sameValues(actualDestinationUris, expectedDestinationUris),
        `Access destination drift for ${expected.domain}: expected ${expectedDestinationUris.join(",")}; received ${actualDestinationUris.join(",") || "none"}.`,
      );
    }
    resolved.set(expected.key, application);
  }

  const resolvedIds = new Set([...resolved.values()].map((application) => application.id));
  const unexpected = applications.filter((application) => !resolvedIds.has(application.id));
  assert(
    unexpected.length === 0,
    `Unexpected overlapping Access application(s): ${unexpected.map((application) => application.id).join(",")}.`,
  );

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
  const matching = selectBoundaryApplications(all, boundary);
  for (const application of matching) {
    application.policies = await cloudflareRequest(
      token,
      "GET",
      `/accounts/${ACCOUNT_ID}/access/apps/${application.id}/policies?per_page=100`,
    );
  }
  return matching;
};

export const applyAccessBoundary = async (
  boundary,
  { fetchApplications: fetchApplicationsImpl, updateApplication, rollback = false },
) => {
  let applications = await fetchApplicationsImpl();
  let plan = planAccessBoundary(applications, boundary);
  const orderedActions = orderAccessActions(plan.actions, rollback);

  for (const plannedAction of orderedActions) {
    applications = await fetchApplicationsImpl();
    plan = planAccessBoundary(applications, boundary);
    const action = plan.actions.find((candidate) => candidate.key === plannedAction.key);
    if (!action) continue;
    assert(
      action.appId === plannedAction.appId
        && action.fromDomain === plannedAction.fromDomain
        && action.toDomain === plannedAction.toDomain,
      `Access application ${plannedAction.key} changed after planning.`,
    );
    const application = plan.applications.get(action.key);
    const desired = boundary.applications.find((entry) => entry.key === action.key);
    assert(application?.id === action.appId && desired, "Access application identity changed before mutation.");
    await updateApplication({ application, desired, action });
  }

  applications = await fetchApplicationsImpl();
  plan = planAccessBoundary(applications, boundary);
  assert(plan.actions.length === 0, "Staging Access reconciliation did not converge.");
  return plan;
};

const assertAccessRedirect = (response, url, expectedAudience) => {
  assert(response.status >= 300 && response.status < 400, `${url} must redirect to Access.`);
  const audience = parseAccessRedirectAudience(response.headers.get("location") ?? "");
  assert(audience === expectedAudience, `Unexpected Access audience for ${url}.`);
};

export const verifyHttpAccessBoundary = async (
  boundary,
  { fetchImpl = fetch } = {},
) => {
  assert(boundary.originProbeUrl, "An origin probe URL is required for Access-only verification.");
  const originResponse = await fetchImpl(boundary.originProbeUrl, { redirect: "manual" });
  const contentType = originResponse.headers.get("content-type") ?? "";
  assert(
    originResponse.status === 200 && contentType.includes("application/json"),
    `${boundary.originProbeUrl} must reach the LinkSim origin health endpoint.`,
  );
  const payload = await originResponse.json();
  assert(
    payload?.ok === true && payload?.service === "linksim-api",
    `${boundary.originProbeUrl} returned an unexpected origin health response.`,
  );

  if (boundary.legacyMigrationUrl) {
    const legacyResponse = await fetchImpl(boundary.legacyMigrationUrl, { redirect: "manual" });
    assertAccessRedirect(legacyResponse, boundary.legacyMigrationUrl, boundary.acceptedAudiences[0]);
  }

};

export const verifyHttpBoundary = async (
  boundary,
  { expectPagesRedirect = false, fetchImpl = fetch } = {},
) => {
  const rootResponse = await fetchImpl(boundary.rootUrl, { redirect: "manual" });
  assert(rootResponse.status === 200, `${boundary.rootUrl} must return 200 anonymously; received ${rootResponse.status}.`);

  const apiResponse = await fetchImpl(boundary.apiUrl, { redirect: "manual" });
  if (boundary.apiAuthMode === "application") {
    assert(apiResponse.status === 401, `${boundary.apiUrl} must return the application 401; received ${apiResponse.status}.`);
    const contentType = apiResponse.headers.get("content-type") ?? "";
    assert(contentType.includes("application/json"), `${boundary.apiUrl} must return a JSON application error.`);
    const payload = await apiResponse.json();
    assert(payload?.error === "Unauthorized.", `${boundary.apiUrl} returned an unexpected application error.`);
  } else {
    assert(apiResponse.status >= 300 && apiResponse.status < 400, `${boundary.apiUrl} must redirect to Access.`);
    const apiAudience = parseAccessRedirectAudience(apiResponse.headers.get("location") ?? "");
    assert(apiAudience === boundary.acceptedAudiences[0], `Unexpected API Access audience for ${boundary.apiUrl}.`);
  }

  if (boundary.legacyMigrationUrl) {
    const legacyResponse = await fetchImpl(boundary.legacyMigrationUrl, { redirect: "manual" });
    assert(legacyResponse.status >= 300 && legacyResponse.status < 400, `${boundary.legacyMigrationUrl} must redirect to Access.`);
    const legacyAudience = parseAccessRedirectAudience(legacyResponse.headers.get("location") ?? "");
    assert(legacyAudience === boundary.acceptedAudiences[0], `Unexpected legacy Access audience for ${boundary.legacyMigrationUrl}.`);
  }

  if (boundary.authBootstrapUrl) {
    const authBootstrapResponse = await fetchImpl(boundary.authBootstrapUrl, { redirect: "manual" });
    assert(
      authBootstrapResponse.status === 200,
      `${boundary.authBootstrapUrl} must return Better Auth options anonymously; received ${authBootstrapResponse.status}.`,
    );
  }

  if (boundary.authManagementUrl) {
    const authManagementResponse = await fetchImpl(boundary.authManagementUrl, { redirect: "manual" });
    assert(
      authManagementResponse.status === 401,
      `${boundary.authManagementUrl} must reject an anonymous Better Auth management request with 401; received ${authManagementResponse.status}.`,
    );
  }

  if (expectPagesRedirect && boundary.pagesRootUrl) {
    const pagesResponse = await fetchImpl(boundary.pagesRootUrl, { redirect: "manual" });
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
    ["plan", "apply", "rollback", "check", "check-access", "check-preview"].includes(mode),
    "Usage: access-boundary.mjs <plan|apply|rollback|check|check-access|check-preview> <staging|production>",
  );
  const configuredBoundary = ACCESS_BOUNDARIES[environment];
  assert(configuredBoundary, `Unknown Access environment: ${environment ?? ""}.`);
  const boundary = mode === "rollback" ? STAGING_ACCESS_ROLLBACK_BOUNDARY : configuredBoundary;
  assert(!["apply", "rollback"].includes(mode) || environment === "staging", "Production Access mutation is not supported.");
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

  if (mode === "check-access") {
    await verifyHttpAccessBoundary(boundary);
    console.log(`[access-boundary] ${environment} Access routing verified.`);
    return;
  }

  const token = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
  assert(token, "CLOUDFLARE_API_TOKEN is required for plan and apply modes.");

  let applications = await fetchApplications(token, boundary);
  let plan = planAccessBoundary(applications, boundary);
  console.log(`[access-boundary] ${environment} plan: ${plan.actions.length} application update(s).`);
  for (const action of plan.actions) {
    console.log(`[access-boundary] ${action.key}: ${action.fromDomain} -> ${action.toDomain}`);
  }

  if (mode === "plan") return;

  assert(plan.actions.length <= 2, "Refusing to apply more than two Access application updates.");
  const allowedKeys = new Set(["api", "publicApi"]);
  assert(plan.actions.every((action) => allowedKeys.has(action.key)), "Refusing an unexpected Access application update.");
  await applyAccessBoundary(boundary, {
    rollback: mode === "rollback",
    fetchApplications: () => fetchApplications(token, boundary),
    updateApplication: async ({ application, desired, action }) => {
      const applicationDetail = await cloudflareRequest(
        token,
        "GET",
        `/accounts/${ACCOUNT_ID}/access/apps/${application.id}`,
      );
      const policies = await cloudflareRequest(
        token,
        "GET",
        `/accounts/${ACCOUNT_ID}/access/apps/${application.id}/policies?per_page=100`,
      );
      const freshApplication = { ...applicationDetail, policies };
      assert(freshApplication.id === application.id, "Access application detail ID changed before mutation.");
      assert(freshApplication.type === "self_hosted", "Access application type changed before mutation.");
      assert(
        matchesApplicationState(freshApplication, desired, "current"),
        `Access application ${action.key} changed after the final boundary plan.`,
      );
      await cloudflareRequest(
        token,
        "PUT",
        `/accounts/${ACCOUNT_ID}/access/apps/${application.id}`,
        buildApplicationUpdate(freshApplication, desired),
      );
    },
  });
  await verifyHttpBoundary(boundary, { expectPagesRedirect: true });
  console.log(`[access-boundary] staging ${mode === "rollback" ? "rollback" : "reconciliation"} and HTTP boundary verified.`);
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`[access-boundary] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
