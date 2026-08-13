import { describe, expect, it } from "vitest";
import {
  corsHeaders,
  corsRejectionResponse,
  getCorsOriginDecision,
  handleOptions,
  normalizeApiErrorMessage,
  statusFromErrorMessage,
  withCors,
} from "./http";

describe("credentialed CORS policy", () => {
  it.each([
    ["https://linksim.link/api/me", "https://linksim.link"],
    ["https://staging.linksim.link/api/me", "https://staging.linksim.link"],
    ["https://6ed2da50.linksim-staging.pages.dev/api/me", "https://6ed2da50.linksim-staging.pages.dev"],
    ["http://localhost:8788/api/me", "http://localhost:8788"],
    ["http://127.0.0.1:8788/api/me", "http://127.0.0.1:8788"],
    ["http://127.0.0.1:8788/api/me", "http://localhost:5174"],
  ])("allows %s from %s", (url, origin) => {
    expect(getCorsOriginDecision(new Request(url, { headers: { origin } }))).toBe("allowed");
  });

  it.each([
    ["https://linksim.link/api/me", "https://staging.linksim.link"],
    ["https://staging.linksim.link/api/me", "https://linksim.link"],
    ["https://staging.linksim.link/api/me", "https://6ed2da50.linksim-staging.pages.dev"],
    ["https://6ed2da50.linksim-staging.pages.dev/api/me", "https://staging.linksim.link"],
    ["https://linksim.link/api/me", "https://linksim.pages.dev"],
    ["http://127.0.0.1:8788/api/me", "http://localhost:5173"],
    ["http://127.0.0.1:8788/api/me", "http://localhost:5175"],
    ["http://localhost:8788/api/me", "http://localhost:5174"],
    ["https://linksim.link/api/me", "null"],
    ["https://linksim.link/api/me", "not a URL"],
    ["https://linksim.link/api/me", "https://linksim.link/path"],
  ])("rejects %s from %s", (url, origin) => {
    expect(getCorsOriginDecision(new Request(url, { headers: { origin } }))).toBe("denied");
  });

  it("allows an originless request without adding credentialed CORS headers", () => {
    const request = new Request("https://linksim.link/api/v1/calculate");
    expect(getCorsOriginDecision(request)).toBe("originless");
    const headers = corsHeaders(request);
    expect(headers.get("access-control-allow-origin")).toBeNull();
    expect(headers.get("access-control-allow-credentials")).toBeNull();
    expect(headers.get("vary")).toBe("Origin");
  });

  it("adds the exact approved origin and credentialed CORS contract", () => {
    const request = new Request("https://staging.linksim.link/api/me", {
      headers: { origin: "https://staging.linksim.link" },
    });
    const response = withCors(request, new Response("ok", { headers: { "cache-control": "no-store" } }));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://staging.linksim.link");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, PATCH, DELETE, OPTIONS");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])(
    "accepts an approved %s preflight",
    (method) => {
      const response = handleOptions(new Request("https://linksim.link/api/me", {
        method: "OPTIONS",
        headers: {
          origin: "https://linksim.link",
          "access-control-request-method": method,
        },
      }));
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://linksim.link");
    },
  );

  it("rejects a disallowed preflight without credentialed CORS headers", () => {
    const request = new Request("https://linksim.link/api/me", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "DELETE" },
    });
    const response = handleOptions(request);
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(corsRejectionResponse(request)?.status).toBe(403);
  });
});

describe("http error normalization", () => {
  it("maps known auth/access errors to stable statuses", () => {
    expect(statusFromErrorMessage("Schema out of date")).toBe(503);
    expect(statusFromErrorMessage("Session revoked by admin")).toBe(401);
    expect(statusFromErrorMessage("Identity subject is no longer current")).toBe(401);
    expect(statusFromErrorMessage("Identity is blocked by an administrator")).toBe(401);
    expect(statusFromErrorMessage("Account access revoked by admin")).toBe(403);
    expect(statusFromErrorMessage("Unauthorized")).toBe(401);
    expect(statusFromErrorMessage("Account pending approval")).toBe(403);
    expect(statusFromErrorMessage("Forbidden")).toBe(403);
    expect(statusFromErrorMessage("User not found")).toBe(404);
    expect(statusFromErrorMessage("Name is required")).toBe(400);
  });

  it("normalizes common messages", () => {
    expect(normalizeApiErrorMessage("Unauthorized token")).toBe("Unauthorized.");
    expect(normalizeApiErrorMessage("pending approval for account")).toBe("Account pending approval.");
    expect(normalizeApiErrorMessage("account access revoked by admin")).toBe("Account access revoked by admin.");
    expect(normalizeApiErrorMessage("Identity subject is no longer current")).toBe("Session revoked by admin.");
    expect(normalizeApiErrorMessage("Identity is blocked by an administrator")).toBe("Session revoked by admin.");
    expect(normalizeApiErrorMessage("")).toBe("Request failed.");
  });
});
