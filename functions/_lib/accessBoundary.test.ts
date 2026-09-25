import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_BOUNDARIES,
  PRODUCTION_ACCESS_CUTOVER_BOUNDARY,
  PRODUCTION_ACCESS_ROLLBACK_BOUNDARY,
  STAGING_ACCESS_ROLLBACK_BOUNDARY,
  applyAccessBoundary,
  buildApplicationUpdate,
  isAccessPlanMode,
  orderAccessActions,
  parseAccessRedirectAudience,
  planAccessBoundary,
  resolveAccessBoundary,
  selectBoundaryApplications,
  validateAcceptedAudiences,
  validatePreviewUrl,
  verifyPreviewBoundary,
  verifyHttpAccessBoundary,
  verifyHttpBoundary,
} from "../../scripts/access-boundary.mjs";

const PUBLIC_POLICY_ID = "32915afb-f399-4c5c-90ea-e5bf0f377b7c";
const PUBLIC_API_POLICY_ID = "d0a1003c-ce29-4f14-a635-58463e82020b";
const AUTH_POLICY_ID = "fd96072d-843b-4320-811a-281767b011ee";

const makeApp = ({
  id,
  name,
  domain,
  aud,
  policyId,
  decision,
  destinations,
}: {
  id: string;
  name: string;
  domain: string;
  aud: string;
  policyId: string;
  decision: "allow" | "bypass";
  destinations?: Array<{ type: "public"; uri: string }>;
}) => ({
  id,
  name,
  domain,
  type: "self_hosted",
  aud,
  session_duration: "24h",
  policies: [{ id: policyId, name: `${decision} policy`, decision, precedence: 1 }],
  destinations,
});

const stagingApps = () => [
  makeApp({
    id: "de019d23-db41-410d-8d33-b61bb2d86beb",
    name: "LinkSim Staging Public App Shell",
    domain: "staging.linksim.link",
    aud: "shell-aud",
    policyId: PUBLIC_POLICY_ID,
    decision: "bypass",
  }),
  makeApp({
    id: "3b76dae4-589d-47bb-b69c-f6dcfabd7169",
    name: "LinkSim Staging Public API Exceptions",
    domain: "staging.linksim.link/api/v1/calculate*",
    aud: "public-api-aud",
    policyId: PUBLIC_API_POLICY_ID,
    decision: "bypass",
    destinations: [
      { type: "public", uri: "staging.linksim.link/api/v1/calculate*" },
      { type: "public", uri: "staging.linksim.link/copernicus/*" },
      { type: "public", uri: "staging.linksim.link/api/public-simulation*" },
      { type: "public", uri: "staging.linksim.link/api/auth/*" },
    ],
  }),
  makeApp({
    id: "7db960b9-188b-4735-b84e-1ee672b60703",
    name: "LinkSim Staging Authenticated API",
    domain: "staging.linksim.link/api/*",
    aud: "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
    policyId: AUTH_POLICY_ID,
    decision: "allow",
  }),
  makeApp({
    id: "pages-root",
    name: "LinkSim Staging Pages Root",
    domain: "linksim-staging.pages.dev",
    aud: "2a5d033ef624d21f08eeb36b75799b81a6fa00536f2341a2ef53301dc36bf19c",
    policyId: PUBLIC_POLICY_ID,
    decision: "bypass",
  }),
  makeApp({
    id: "preview",
    name: "LinkSim Staging Pages Previews",
    domain: "*.linksim-staging.pages.dev",
    aud: "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
    policyId: AUTH_POLICY_ID,
    decision: "allow",
  }),
];

const productionApps = () => [
  makeApp({
    id: "production-shell",
    name: "LinkSim Production Public App Shell",
    domain: "linksim.link",
    aud: "production-shell-aud",
    policyId: PUBLIC_POLICY_ID,
    decision: "bypass",
  }),
  makeApp({
    id: "production-api",
    name: "LinkSim Authenticated API",
    domain: "linksim.link/api/*",
    aud: "ad63aaad91fb903f77154106fc69bb0fe7b845bfeb87ce09287b0c6dc92027b2",
    policyId: AUTH_POLICY_ID,
    decision: "allow",
  }),
];

describe("Cloudflare Access boundary reconciliation", () => {
  it("plans only the two staging API application updates", () => {
    const plan = planAccessBoundary(stagingApps(), ACCESS_BOUNDARIES.staging);

    expect(plan.actions.map(({ key, fromDomain, toDomain }) => ({ key, fromDomain, toDomain }))).toEqual([
      {
        key: "publicApi",
        fromDomain: "staging.linksim.link/api/v1/calculate*",
        toDomain: "staging.linksim.link/api/*",
      },
      {
        key: "api",
        fromDomain: "staging.linksim.link/api/*",
        toDomain: "staging.linksim.link/api/auth/legacy-access/*",
      },
    ]);
    expect(plan.authenticatedAudiences).toEqual([
      "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
    ]);
  });

  it("is idempotent once Better Auth is authoritative and plans the exact rollback", () => {
    const apps = stagingApps();
    apps[1] = makeApp({
      id: "3b76dae4-589d-47bb-b69c-f6dcfabd7169",
      name: "LinkSim Staging Application API",
      domain: "staging.linksim.link/api/*",
      aud: "public-api-aud",
      policyId: PUBLIC_API_POLICY_ID,
      decision: "bypass",
      destinations: [
        { type: "public", uri: "staging.linksim.link/api/*" },
        { type: "public", uri: "staging.linksim.link/copernicus/*" },
      ],
    });
    apps[2] = makeApp({
      id: "7db960b9-188b-4735-b84e-1ee672b60703",
      name: "LinkSim Staging Legacy Migration API",
      domain: "staging.linksim.link/api/auth/legacy-access/*",
      aud: "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      policyId: AUTH_POLICY_ID,
      decision: "allow",
      destinations: [
        { type: "public", uri: "staging.linksim.link/api/auth/legacy-access/*" },
      ],
    });

    expect(planAccessBoundary(apps, ACCESS_BOUNDARIES.staging).actions).toEqual([]);
    expect(planAccessBoundary(apps, STAGING_ACCESS_ROLLBACK_BOUNDARY).actions.map(({ key }) => key))
      .toEqual(["publicApi", "api"]);
  });

  it("orders cutover and rollback mutations without opening the legacy proof path", () => {
    const actions = [
      { key: "publicApi" },
      { key: "api" },
    ];
    expect(orderAccessActions(actions, false).map(({ key }) => key)).toEqual(["api", "publicApi"]);
    expect(orderAccessActions(actions, true).map(({ key }) => key)).toEqual(["publicApi", "api"]);
  });

  it("plans one exact production cutover change and its inverse rollback", () => {
    const current = productionApps();
    const cutover = planAccessBoundary(current, PRODUCTION_ACCESS_CUTOVER_BOUNDARY);
    expect(cutover.actions.map(({ key, fromDomain, toDomain }) => ({ key, fromDomain, toDomain })))
      .toEqual([{
        key: "api",
        fromDomain: "linksim.link/api/*",
        toDomain: "linksim.link/api/auth/legacy-access/*",
      }]);

    current[1] = makeApp({
      id: "production-api",
      name: "LinkSim Legacy Migration API",
      domain: "linksim.link/api/auth/legacy-access/*",
      aud: "ad63aaad91fb903f77154106fc69bb0fe7b845bfeb87ce09287b0c6dc92027b2",
      policyId: AUTH_POLICY_ID,
      decision: "allow",
      destinations: [{ type: "public", uri: "linksim.link/api/auth/legacy-access/*" }],
    });
    expect(planAccessBoundary(current, PRODUCTION_ACCESS_CUTOVER_BOUNDARY).actions).toEqual([]);
    expect(planAccessBoundary(current, PRODUCTION_ACCESS_ROLLBACK_BOUNDARY).actions.map(({ key }) => key))
      .toEqual(["api"]);
  });

  it("keeps every production plan mode read only", () => {
    expect(isAccessPlanMode("plan")).toBe(true);
    expect(isAccessPlanMode("plan-cutover")).toBe(true);
    expect(isAccessPlanMode("plan-rollback")).toBe(true);
    expect(isAccessPlanMode("apply")).toBe(false);
    expect(isAccessPlanMode("rollback")).toBe(false);
  });

  it("uses the post-cutover boundary only for the explicit production check mode", () => {
    expect(resolveAccessBoundary("check", "production"))
      .toBe(ACCESS_BOUNDARIES.production);
    expect(resolveAccessBoundary("check-cutover", "production"))
      .toBe(PRODUCTION_ACCESS_CUTOVER_BOUNDARY);
    expect(() => resolveAccessBoundary("check-cutover", "staging"))
      .toThrow("Production cutover checks require the production environment");
  });

  it("fails closed on production overlap or an unexpected transition", () => {
    const overlapping = makeApp({
      id: "unexpected-production-overlap",
      name: "Unexpected production API",
      domain: "linksim.link/api/library*",
      aud: "unexpected",
      policyId: PUBLIC_POLICY_ID,
      decision: "bypass",
    });
    expect(() => planAccessBoundary(
      selectBoundaryApplications(
        [...productionApps(), overlapping],
        PRODUCTION_ACCESS_CUTOVER_BOUNDARY,
      ),
      PRODUCTION_ACCESS_CUTOVER_BOUNDARY,
    )).toThrow("Unexpected overlapping Access application");

    const drifted = productionApps();
    drifted[1] = { ...drifted[1], domain: "linksim.link/api/private/*" };
    expect(() => planAccessBoundary(drifted, PRODUCTION_ACCESS_CUTOVER_BOUNDARY))
      .toThrow("Expected exactly one Access application");
  });

  it("fails closed instead of creating, deleting, or guessing applications", () => {
    expect(() => planAccessBoundary(stagingApps().slice(1), ACCESS_BOUNDARIES.staging)).toThrow(
      "de019d23-db41-410d-8d33-b61bb2d86beb",
    );
    expect(() =>
      planAccessBoundary([...stagingApps(), stagingApps()[1]], ACCESS_BOUNDARIES.staging),
    ).toThrow("exactly one");
    expect(() => planAccessBoundary([
      ...stagingApps(),
      { ...stagingApps()[1], id: "unexpected-overlap" },
    ], ACCESS_BOUNDARIES.staging)).toThrow("Unexpected overlapping Access application");
  });

  it("discovers and rejects narrower and wildcard applications that overlap staging", () => {
    const narrower = {
      ...stagingApps()[1],
      id: "unexpected-narrower",
      domain: "staging.linksim.link/api/library*",
      destinations: [{ type: "public" as const, uri: "staging.linksim.link/api/library*" }],
    };
    const broader = {
      ...stagingApps()[1],
      id: "unexpected-broader",
      domain: "*.linksim.link",
      destinations: [{ type: "public" as const, uri: "*.linksim.link" }],
    };
    const selected = selectBoundaryApplications(
      [...stagingApps(), narrower, broader],
      ACCESS_BOUNDARIES.staging,
    );
    expect(selected.map(({ id }) => id)).toContain("unexpected-narrower");
    expect(selected.map(({ id }) => id)).toContain("unexpected-broader");
    expect(() => planAccessBoundary(selected, ACCESS_BOUNDARIES.staging))
      .toThrow("Unexpected overlapping Access application");
  });

  it("re-plans the complete boundary before each mutation and refuses intervening drift", async () => {
    const initial = stagingApps();
    const afterFirstMutation = stagingApps();
    afterFirstMutation[2] = makeApp({
      id: "7db960b9-188b-4735-b84e-1ee672b60703",
      name: "LinkSim Staging Legacy Migration API",
      domain: "staging.linksim.link/api/auth/legacy-access/*",
      aud: "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      policyId: AUTH_POLICY_ID,
      decision: "allow",
      destinations: [{ type: "public", uri: "staging.linksim.link/api/auth/legacy-access/*" }],
    });
    afterFirstMutation[1] = {
      ...afterFirstMutation[1],
      destinations: [{ type: "public", uri: "staging.linksim.link/unreviewed/*" }],
    };
    const fetchApplications = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(afterFirstMutation);
    const updateApplication = vi.fn().mockResolvedValue(undefined);

    await expect(applyAccessBoundary(ACCESS_BOUNDARIES.staging, {
      fetchApplications,
      updateApplication,
    })).rejects.toThrow("Access destination drift");
    expect(updateApplication).toHaveBeenCalledOnce();
    expect(fetchApplications).toHaveBeenCalledTimes(3);
  });

  it("fails closed when a mutable application has unexpected destination drift", () => {
    const apps = stagingApps();
    apps[1] = {
      ...apps[1],
      destinations: [{ type: "public", uri: "staging.linksim.link/unrelated/*" }],
    };
    expect(() => planAccessBoundary(apps, ACCESS_BOUNDARIES.staging)).toThrow("Access destination drift");
  });

  it("preserves supported settings while applying the reviewed application boundary", () => {
    const app = {
      ...stagingApps()[3],
      allowed_idps: ["github-idp"],
      auto_redirect_to_identity: true,
      app_launcher_visible: false,
      options_preflight_bypass: true,
      destinations: [{ type: "public", uri: "linksim-staging.pages.dev" }],
      custom_pages: ["deny-page-id"],
      purpose_justification_prompt: "Why do you need access?",
      purpose_justification_required: true,
      read_service_tokens_from_header: "Authorization",
      mfa_config: { mfa_disabled: false, session_duration: "12h" },
      created_at: "ignored",
      updated_at: "ignored",
    };

    expect(buildApplicationUpdate(app, {
      name: "LinkSim Staging Legacy Migration API",
      domain: "staging.linksim.link/api/auth/legacy-access/*",
      destinationUris: ["staging.linksim.link/api/auth/legacy-access/*"],
      policyId: AUTH_POLICY_ID,
    })).toEqual({
      name: "LinkSim Staging Legacy Migration API",
      domain: "staging.linksim.link/api/auth/legacy-access/*",
      type: "self_hosted",
      session_duration: "24h",
      allowed_idps: ["github-idp"],
      auto_redirect_to_identity: true,
      app_launcher_visible: false,
      options_preflight_bypass: true,
      destinations: [{ type: "public", uri: "staging.linksim.link/api/auth/legacy-access/*" }],
      custom_pages: ["deny-page-id"],
      purpose_justification_prompt: "Why do you need access?",
      purpose_justification_required: true,
      read_service_tokens_from_header: "Authorization",
      mfa_config: { mfa_disabled: false, session_duration: "12h" },
      policies: [{ id: AUTH_POLICY_ID, precedence: 1 }],
    });
  });

  it("accepts only JWT-issuing API and preview audiences", () => {
    const expected = ACCESS_BOUNDARIES.staging.acceptedAudiences;
    expect(validateAcceptedAudiences(expected.join(","), expected)).toEqual(expected);
    expect(() =>
      validateAcceptedAudiences(
        [...expected, "2a5d033ef624d21f08eeb36b75799b81a6fa00536f2341a2ef53301dc36bf19c"].join(","),
        expected,
      ),
    ).toThrow("ACCESS_AUD");
  });

  it("lets LinkSim reject anonymous APIs while the reserved migration path stays on Access", async () => {
    const responses = new Map([
      [ACCESS_BOUNDARIES.staging.rootUrl, new Response("shell", { status: 200 })],
      [ACCESS_BOUNDARIES.staging.apiUrl, Response.json({ error: "Unauthorized." }, { status: 401 })],
      [ACCESS_BOUNDARIES.staging.legacyMigrationUrl, new Response(null, {
        status: 302,
        headers: {
          location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/api?kid=e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
        },
      })],
      [ACCESS_BOUNDARIES.staging.authBootstrapUrl, new Response("options", { status: 200 })],
      [ACCESS_BOUNDARIES.staging.authManagementUrl, new Response("unauthorized", { status: 401 })],
      [ACCESS_BOUNDARIES.staging.pagesRootUrl, new Response(null, {
        status: 302,
        headers: { location: ACCESS_BOUNDARIES.staging.pagesRootRedirect },
      })],
    ]);
    const fetchBoundary = vi.fn(async (input: string | URL) => {
      const response = responses.get(String(input));
      if (!response) throw new Error(`Unexpected URL: ${String(input)}`);
      return response;
    });

    await expect(verifyHttpBoundary(
      ACCESS_BOUNDARIES.staging,
      { expectPagesRedirect: true, fetchImpl: fetchBoundary },
    )).resolves.toBeUndefined();
    expect(fetchBoundary).toHaveBeenCalledWith(ACCESS_BOUNDARIES.staging.authBootstrapUrl, { redirect: "manual" });
    expect(fetchBoundary).toHaveBeenCalledWith(ACCESS_BOUNDARIES.staging.authManagementUrl, { redirect: "manual" });
    expect(fetchBoundary).toHaveBeenCalledWith(ACCESS_BOUNDARIES.staging.legacyMigrationUrl, { redirect: "manual" });
  });

  it("extracts the Access application audience from a login redirect", () => {
    expect(
      parseAccessRedirectAudience(
        "https://team.cloudflareaccess.com/cdn-cgi/access/login/staging.linksim.link?kid=api-aud&redirect_url=%2Fapi%2Fme",
      ),
    ).toBe("api-aud");
    expect(() => parseAccessRedirectAudience("https://staging.linksim.link/")).toThrow(
      "Access login redirect",
    );
  });

  it("accepts only an immutable staging preview with the exact Access audience", async () => {
    const previewUrl = "https://issue-1062.linksim-staging.pages.dev/Owner/Simulation";
    expect(validatePreviewUrl(previewUrl).href).toBe(previewUrl);
    expect(() => validatePreviewUrl("https://linksim-staging.pages.dev/")).toThrow(
      "Unexpected staging preview hostname",
    );
    expect(() => validatePreviewUrl("https://preview.attacker.example/")).toThrow(
      "Unexpected staging preview hostname",
    );

    const fetchPreview = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location:
            "https://team.cloudflareaccess.com/cdn-cgi/access/login/preview?kid=7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
        },
      }),
    );
    await expect(
      verifyPreviewBoundary(previewUrl, ACCESS_BOUNDARIES.staging, fetchPreview),
    ).resolves.toBeUndefined();
    expect(fetchPreview).toHaveBeenCalledWith(new URL(previewUrl), { redirect: "manual" });

    const fetchPublicPreview = vi.fn(async () => new Response("public", { status: 200 }));
    await expect(
      verifyPreviewBoundary(previewUrl, ACCESS_BOUNDARIES.staging, fetchPublicPreview),
    ).rejects.toThrow("must redirect to Access");
  });

  it("checks staging Access routing without depending on auth runtime health", async () => {
    const responses = new Map<string, Response>([
      [ACCESS_BOUNDARIES.staging.originProbeUrl, new Response(JSON.stringify({
        ok: true,
        service: "linksim-api",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })],
      [ACCESS_BOUNDARIES.staging.legacyMigrationUrl, new Response(null, {
        status: 302,
        headers: {
          location:
            "https://team.cloudflareaccess.com/cdn-cgi/access/login/staging.linksim.link?kid=e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
        },
      })],
    ]);
    const fetchBoundary = vi.fn(async (input: string | URL) => {
      const response = responses.get(String(input));
      if (!response) throw new Error(`Unexpected URL: ${String(input)}`);
      return response;
    });

    await expect(verifyHttpAccessBoundary(
      ACCESS_BOUNDARIES.staging,
      { fetchImpl: fetchBoundary },
    )).resolves.toBeUndefined();
    expect(fetchBoundary).not.toHaveBeenCalledWith(
      ACCESS_BOUNDARIES.staging.apiUrl,
      { redirect: "manual" },
    );
    expect(fetchBoundary).not.toHaveBeenCalledWith(
      ACCESS_BOUNDARIES.staging.authBootstrapUrl,
      { redirect: "manual" },
    );
    expect(fetchBoundary).not.toHaveBeenCalledWith(
      ACCESS_BOUNDARIES.staging.authManagementUrl,
      { redirect: "manual" },
    );

    responses.set(ACCESS_BOUNDARIES.staging.originProbeUrl, new Response("Access denied", {
      status: 403,
    }));
    await expect(verifyHttpAccessBoundary(
      ACCESS_BOUNDARIES.staging,
      { fetchImpl: fetchBoundary },
    )).rejects.toThrow("must reach the LinkSim origin health endpoint");
  });

  it("verifies the complete restored Access boundary after rollback", async () => {
    const responses = new Map<string, Response>([
      [STAGING_ACCESS_ROLLBACK_BOUNDARY.rootUrl, new Response("app", { status: 200 })],
      [STAGING_ACCESS_ROLLBACK_BOUNDARY.apiUrl, new Response(null, {
        status: 302,
        headers: {
          location:
            "https://team.cloudflareaccess.com/cdn-cgi/access/login/staging.linksim.link?kid=e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
        },
      })],
      [STAGING_ACCESS_ROLLBACK_BOUNDARY.pagesRootUrl, new Response(null, {
        status: 308,
        headers: { location: STAGING_ACCESS_ROLLBACK_BOUNDARY.pagesRootRedirect },
      })],
    ]);
    const fetchBoundary = vi.fn(async (input: string | URL) => {
      const response = responses.get(String(input));
      if (!response) throw new Error(`Unexpected URL: ${String(input)}`);
      return response;
    });

    await expect(verifyHttpBoundary(
      STAGING_ACCESS_ROLLBACK_BOUNDARY,
      { expectPagesRedirect: true, fetchImpl: fetchBoundary },
    )).resolves.toBeUndefined();
    expect(STAGING_ACCESS_ROLLBACK_BOUNDARY.legacyMigrationUrl).toBeUndefined();
    expect(fetchBoundary).toHaveBeenCalledTimes(3);
  });
});
