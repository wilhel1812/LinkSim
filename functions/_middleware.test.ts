import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";

const invoke = async (url: string, init?: RequestInit) => {
  const next = vi.fn(async () => new Response("app", { status: 200 }));
  const response = await onRequest({ request: new Request(url, init), next });
  return { response, next };
};

describe("canonical Pages host middleware", () => {
  it.each([
    ["https://linksim-staging.pages.dev/Owner/Simulation?mode=test", "https://staging.linksim.link/Owner/Simulation?mode=test"],
    ["https://linksim.pages.dev/Owner/Simulation", "https://linksim.link/Owner/Simulation"],
  ])("redirects the raw Pages root %s", async (url, expected) => {
    const { response, next } = await invoke(url);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(expected);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "https://staging.linksim.link/",
    "https://linksim.link/",
    "https://6ed2da50.linksim-staging.pages.dev/",
  ])("passes canonical and immutable preview hosts through: %s", async (url) => {
    const { response, next } = await invoke(url);
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("API origin boundary", () => {
  it.each([
    ["PATCH", "administrator role mutation", "https://linksim.link/api/users/user-1"],
    ["DELETE", "user deletion", "https://linksim.link/api/users/user-1"],
    ["POST", "ownership reassignment", "https://linksim.link/api/admin-ownership-tools"],
    ["PUT", "Library write", "https://linksim.link/api/library"],
    ["DELETE", "Library deletion", "https://linksim.link/api/library/simulations/sim-1"],
    ["POST", "change revert", "https://linksim.link/api/changes"],
  ])("rejects cross-origin %s before the %s handler", async (method, _behavior, url) => {
    const { response, next } = await invoke(url, {
      method,
      headers: {
        origin: "https://attacker.example",
        cookie: "CF_Authorization=stolen-browser-cookie",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "mutation" }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a same-origin guest public Simulation read", async () => {
    const { response, next } = await invoke(
      "https://staging.linksim.link/api/public-simulation?sim=sim-1",
      { headers: { origin: "https://staging.linksim.link" } },
    );
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows an originless guest deep-link read", async () => {
    const { response, next } = await invoke(
      "https://linksim.link/api/deep-link-status?sim=sim-1",
    );
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not apply the API boundary to app routes", async () => {
    const { response, next } = await invoke("https://linksim.link/Owner/Simulation", {
      headers: { origin: "https://attacker.example" },
    });
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});
