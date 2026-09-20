import { describe, expect, it } from "vitest";

import { requiresApiAuthentication } from "./apiRoutePolicy";

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
  ])("protects %s %s", (method, path) => {
    expect(requiresApiAuthentication(new Request(`https://linksim.link${path}`, { method })))
      .toBe(true);
  });

  it("does not classify non-API app routes as protected APIs", () => {
    expect(requiresApiAuthentication(new Request("https://linksim.link/Owner/Simulation")))
      .toBe(false);
  });
});
