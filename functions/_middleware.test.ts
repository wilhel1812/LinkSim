import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";

const invoke = async (url: string) => {
  const next = vi.fn(async () => new Response("app", { status: 200 }));
  const response = await onRequest({ request: new Request(url), next });
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
