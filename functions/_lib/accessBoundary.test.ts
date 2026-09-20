import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_BOUNDARIES,
  buildApplicationPolicyUpdate,
  parseAccessRedirectAudience,
  planAccessBoundary,
  validateAcceptedAudiences,
  validatePreviewUrl,
  verifyPreviewBoundary,
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
    id: "shell",
    name: "LinkSim Staging Public App Shell",
    domain: "staging.linksim.link",
    aud: "shell-aud",
    policyId: PUBLIC_POLICY_ID,
    decision: "bypass",
  }),
  makeApp({
    id: "public-api",
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
    id: "api",
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
    policyId: AUTH_POLICY_ID,
    decision: "allow",
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

describe("Cloudflare Access boundary reconciliation", () => {
  it("plans only the staging Pages-root policy replacement", () => {
    const plan = planAccessBoundary(stagingApps(), ACCESS_BOUNDARIES.staging);

    expect(plan.actions).toEqual([
      {
        appId: "pages-root",
        domain: "linksim-staging.pages.dev",
        fromPolicyIds: [AUTH_POLICY_ID],
        toPolicyId: PUBLIC_POLICY_ID,
      },
    ]);
    expect(plan.authenticatedAudiences).toEqual([
      "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131",
      "7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283",
    ]);
  });

  it("is idempotent once the Pages root uses the bypass policy", () => {
    const apps = stagingApps();
    apps[3] = makeApp({
      id: "pages-root",
      name: "LinkSim Staging Pages Root",
      domain: "linksim-staging.pages.dev",
      aud: "2a5d033ef624d21f08eeb36b75799b81a6fa00536f2341a2ef53301dc36bf19c",
      policyId: PUBLIC_POLICY_ID,
      decision: "bypass",
    });

    expect(planAccessBoundary(apps, ACCESS_BOUNDARIES.staging).actions).toEqual([]);
  });

  it("fails closed instead of creating, deleting, or guessing applications", () => {
    expect(() => planAccessBoundary(stagingApps().slice(1), ACCESS_BOUNDARIES.staging)).toThrow(
      "staging.linksim.link",
    );
    expect(() =>
      planAccessBoundary([...stagingApps(), stagingApps()[1]], ACCESS_BOUNDARIES.staging),
    ).toThrow("exactly one");
  });

  it("fails closed when the existing public API application does not expose the exact Better Auth namespace", () => {
    const apps = stagingApps();
    apps[1] = { ...apps[1], destinations: apps[1].destinations?.slice(0, 3) };
    expect(() => planAccessBoundary(apps, ACCESS_BOUNDARIES.staging)).toThrow("Access destination drift");
  });

  it("preserves supported application settings while changing only policy bindings", () => {
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

    expect(buildApplicationPolicyUpdate(app, PUBLIC_POLICY_ID)).toEqual({
      name: "LinkSim Staging Pages Root",
      domain: "linksim-staging.pages.dev",
      type: "self_hosted",
      session_duration: "24h",
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
      policies: [{ id: PUBLIC_POLICY_ID, precedence: 1 }],
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

  it("keeps Better Auth bootstrap public while protected APIs and credential management stay closed", async () => {
    const responses = new Map([
      [ACCESS_BOUNDARIES.staging.rootUrl, new Response("shell", { status: 200 })],
      [ACCESS_BOUNDARIES.staging.apiUrl, new Response(null, {
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
});
