// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthReturnPath,
  consumeAuthCallbackError,
  createGithubPilotSignIn,
  getTurnstileToken,
  isBetterAuthPilotEnabled,
} from "./betterAuthPilot";

describe("Better Auth pilot client", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/wilhelm/Svalbard/Pyramiden?layer=terrain#profile");
  });

  it("requires both the explicit pilot flag and a Turnstile site key", () => {
    expect(isBetterAuthPilotEnabled({ VITE_BETTER_AUTH_PILOT: "true", VITE_TURNSTILE_SITE_KEY: "site-key" })).toBe(true);
    expect(isBetterAuthPilotEnabled({ VITE_BETTER_AUTH_PILOT: "false", VITE_TURNSTILE_SITE_KEY: "site-key" })).toBe(false);
    expect(isBetterAuthPilotEnabled({ VITE_BETTER_AUTH_PILOT: "true" })).toBe(false);
  });

  it("preserves the same-origin path, query, and fragment for OAuth return", () => {
    expect(buildAuthReturnPath(window.location)).toBe("/wilhelm/Svalbard/Pyramiden?layer=terrain#profile");
    expect(buildAuthReturnPath({ pathname: "//example.test/steal", search: "", hash: "" })).toBe("/");
  });

  it("removes callback error parameters without dropping the rest of the URL", () => {
    window.history.replaceState(null, "", "/wilhelm/Svalbard?layer=terrain&error=access_denied&error_description=nope#profile");
    expect(consumeAuthCallbackError(window.location, window.history)).toBe(true);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/wilhelm/Svalbard?layer=terrain#profile",
    );
    expect(consumeAuthCallbackError(window.location, window.history)).toBe(false);
  });

  it("uses and removes a fresh Turnstile widget for each token", async () => {
    const remove = vi.fn();
    const render = vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
      options.callback(`token-${render.mock.calls.length}`);
      return render.mock.calls.length;
    });
    const load = vi.fn(async () => ({ render, remove }));

    const first = document.createElement("div");
    first.dataset.sitekey = "site-key";
    const second = document.createElement("div");
    second.dataset.sitekey = "site-key";

    await expect(getTurnstileToken(first, { load })).resolves.toBe("token-1");
    await expect(getTurnstileToken(second, { load })).resolves.toBe("token-2");
    expect(render).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("suppresses duplicate initiation and requests a new token after completion", async () => {
    let releaseToken!: (token: string) => void;
    const getToken = vi.fn(() => new Promise<string>((resolve) => { releaseToken = resolve; }));
    const social = vi.fn(async () => ({
      data: { url: "https://github.com/login/oauth/authorize?client_id=test" },
      error: null,
    }));
    const navigate = vi.fn();
    const signIn = createGithubPilotSignIn({
      siteKey: "site-key",
      getToken,
      social,
      navigate,
      createContainer: () => document.createElement("div"),
    });

    const first = signIn(window.location);
    await expect(signIn(window.location)).resolves.toBe("busy");
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('[aria-label="Anti-bot check"]')?.style.position).toBe("fixed");
    releaseToken("fresh-1");
    await expect(first).resolves.toBe("started");
    expect(social).toHaveBeenCalledWith(
      {
        provider: "github",
        callbackURL: "/wilhelm/Svalbard/Pyramiden?layer=terrain#profile",
        errorCallbackURL: "/wilhelm/Svalbard/Pyramiden?layer=terrain#profile",
        disableRedirect: true,
      },
      { headers: { "x-captcha-response": "fresh-1" } },
    );
    expect(navigate).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?client_id=test");

    const second = signIn(window.location);
    releaseToken("fresh-2");
    await expect(second).resolves.toBe("started");
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing or unexpected provider redirect", async () => {
    const navigate = vi.fn();
    const dependencies = {
      siteKey: "site-key",
      getToken: vi.fn(async () => "fresh-token"),
      navigate,
    };

    await expect(createGithubPilotSignIn({
      ...dependencies,
      social: vi.fn(async () => ({ data: { url: null }, error: null })),
    })(window.location)).rejects.toThrow("GitHub sign-in did not return a valid authorization URL");
    await expect(createGithubPilotSignIn({
      ...dependencies,
      social: vi.fn(async () => ({ data: { url: "https://example.test/steal" }, error: null })),
    })(window.location)).rejects.toThrow("GitHub sign-in did not return a valid authorization URL");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("removes the temporary challenge container when Better Auth rejects initiation", async () => {
    const signIn = createGithubPilotSignIn({
      siteKey: "site-key",
      getToken: vi.fn(async () => "fresh-token"),
      social: vi.fn(async () => ({ data: null, error: { message: "rejected" } })),
    });

    await expect(signIn(window.location)).rejects.toThrow("rejected");
    expect(document.querySelector('[aria-label="Anti-bot check"]')).toBeNull();
  });
});
