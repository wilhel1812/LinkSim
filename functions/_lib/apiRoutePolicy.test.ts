import { describe, expect, it } from "vitest";

import { isAuthGatewayRoute, requiresApiAuthentication } from "./apiRoutePolicy";

describe("API authentication policy", () => {
  it.each([
    ["OPTIONS", "/api/library"],
    ["GET", "/api/public-simulation"],
    ["GET", "/api/deep-link-status"],
    ["GET", "/api/stats"],
    ["GET", "/api/health"],
    ["GET", "/api/avatar/users/example/avatar.webp"],
    ["GET", "/api/auth-start"],
    ["POST", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/callback/github"],
    ["POST", "/api/auth/sign-out"],
    ["GET", "/api/auth/passkey/generate-authenticate-options"],
    ["POST", "/api/auth/passkey/verify-authentication"],
    ["GET", "/api/auth/legacy-access/start"],
    ["POST", "/api/auth/legacy-access/complete"],
  ])("keeps the intentional public exception %s %s", (method, path) => {
    expect(requiresApiAuthentication(new Request(`https://linksim.link${path}`, { method })))
      .toBe(false);
  });

  it.each([
    ["GET", "/api/me"],
    ["GET", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/geocode"],
    ["POST", "/api/v1/calculate"],
    ["POST", "/api/calculate"],
    ["POST", "/api/v1/calculate/jobs"],
    ["GET", "/api/v1/calculate/jobs/job-1"],
    ["GET", "/api/auth-diagnostics"],
    ["POST", "/api/avatar-upload"],
    ["POST", "/api/dev-role"],
    ["POST", "/api/path-leaderboard"],
    ["POST", "/api/public-simulation"],
    ["GET", "/api/auth/passkey/generate-register-options"],
    ["POST", "/api/auth/passkey/verify-registration"],
    ["GET", "/api/auth/passkey/list-user-passkeys"],
    ["POST", "/api/auth/passkey/update-passkey"],
    ["POST", "/api/auth/passkey/delete-passkey"],
  ])("protects %s %s", (method, path) => {
    expect(requiresApiAuthentication(new Request(`https://linksim.link${path}`, { method })))
      .toBe(true);
  });

  it.each([
    ["GET", "/api/auth/passkey/generate-authenticate-options"],
    ["POST", "/api/auth/passkey/verify-authentication"],
    ["GET", "/api/auth/passkey/generate-register-options"],
    ["POST", "/api/auth/passkey/verify-registration"],
    ["GET", "/api/auth/passkey/list-user-passkeys"],
    ["POST", "/api/auth/passkey/update-passkey"],
    ["POST", "/api/auth/passkey/delete-passkey"],
  ])("forwards the exact passkey route %s %s", (method, path) => {
    expect(isAuthGatewayRoute(new Request(`https://linksim.link${path}`, { method }))).toBe(true);
  });

  it.each([
    ["GET", "/api/auth/legacy-access/start"],
    ["POST", "/api/auth/legacy-access/complete"],
    ["POST", "/api/auth/passkey/generate-authenticate-options"],
    ["GET", "/api/auth/passkey/verify-authentication"],
    ["POST", "/api/auth/passkey/list-user-passkeys"],
    ["GET", "/api/auth/passkey/update-passkey"],
    ["GET", "/api/auth/passkey/delete-passkey"],
    ["POST", "/api/auth/link-social"],
  ])("does not forward an unlisted auth route %s %s", (method, path) => {
    expect(isAuthGatewayRoute(new Request(`https://linksim.link${path}`, { method }))).toBe(false);
  });

  it("does not classify non-API app routes as protected APIs", () => {
    expect(requiresApiAuthentication(new Request("https://linksim.link/Owner/Simulation")))
      .toBe(false);
  });
});
