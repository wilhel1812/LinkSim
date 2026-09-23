// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthReturnPath,
  buildGithubAuthReturnPath,
  buildLegacyMigrationStartPath,
  clearLegacyMigrationAttempt,
  clearGithubAuthRecovery,
  completeLegacyMigration,
  consumeGithubAuthRecovery,
  consumeGithubAuthReturn,
  consumeAuthCallbackError,
  createPasskeyPilotSignIn,
  createPasskeyManagement,
  createGithubPilotSignIn,
  getTurnstileToken,
  getGithubSignInUiErrorMessage,
  getLegacyMigrationAttempt,
  hasPendingLegacyMigrationConflict,
  getLegacyMigrationUiErrorMessage,
  getPasskeyUiErrorMessage,
  isBetterAuthPilotEnabled,
  markPendingLegacyMigrationConflict,
  PasskeyPilotError,
  requestGithubAuthRecoveryReload,
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

  it("marks and consumes a GitHub callback return without dropping route state", () => {
    expect(buildGithubAuthReturnPath(window.location)).toBe(
      "/wilhelm/Svalbard/Pyramiden?layer=terrain&auth-return=github#profile",
    );
    window.history.replaceState(
      null,
      "",
      "/wilhelm/Svalbard/Pyramiden?layer=terrain&auth-return=github#profile",
    );
    expect(consumeGithubAuthReturn(window.location, window.history)).toBe(true);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/wilhelm/Svalbard/Pyramiden?layer=terrain#profile",
    );
    expect(consumeGithubAuthReturn(window.location, window.history)).toBe(false);
  });

  it("starts legacy migration through the reserved Access path without dropping route state", () => {
    expect(buildLegacyMigrationStartPath(window.location)).toBe(
      "/api/auth/legacy-access/start?returnTo=%2Fwilhelm%2FSvalbard%2FPyramiden%3Flayer%3Dterrain%23profile",
    );
  });

  it("reads and clears only a valid server migration attempt", () => {
    window.history.replaceState(
      null,
      "",
      "/wilhelm/Svalbard?layer=terrain&legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420#profile",
    );
    expect(getLegacyMigrationAttempt(window.location)).toBe("78d2594f-6ef2-4d59-b8de-d42366a4c420");
    clearLegacyMigrationAttempt(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/wilhelm/Svalbard?layer=terrain#profile",
    );

    window.history.replaceState(null, "", "/?legacyMigration=not-an-attempt");
    expect(getLegacyMigrationAttempt(window.location)).toBeNull();
  });

  it("keeps an unresolved migration conflict bound to its attempt until the attempt is cleared", () => {
    const attemptId = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    window.history.replaceState(null, "", `/?legacyMigration=${attemptId}`);

    expect(hasPendingLegacyMigrationConflict(window.location, attemptId)).toBe(false);
    markPendingLegacyMigrationConflict(window.location, window.history, attemptId);
    expect(hasPendingLegacyMigrationConflict(window.location, attemptId)).toBe(true);
    expect(hasPendingLegacyMigrationConflict(window.location, "178d2594f-6ef2-4d59-b8de-d42366a4c420")).toBe(false);

    clearLegacyMigrationAttempt(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/");
    expect(hasPendingLegacyMigrationConflict(window.location, attemptId)).toBe(false);
  });

  it("completes migration with an exact same-origin JSON mutation and safe failures", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(completeLegacyMigration(
      "78d2594f-6ef2-4d59-b8de-d42366a4c420",
      fetcher,
    )).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/auth/legacy-access/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId: "78d2594f-6ef2-4d59-b8de-d42366a4c420" }),
    });

    await expect(completeLegacyMigration(
      "78d2594f-6ef2-4d59-b8de-d42366a4c420",
      vi.fn(async () => new Response(JSON.stringify({ code: "MIGRATION_CONFLICT", error: "internal detail" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      })),
    )).rejects.toMatchObject({ code: "MIGRATION_CONFLICT", status: 409 });
    expect(getLegacyMigrationUiErrorMessage(new Error("database secret leaked"))).toBe(
      "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
    );
  });

  it("uses one session-scoped reload marker for GitHub callback recovery", () => {
    const reload = vi.fn();
    expect(requestGithubAuthRecoveryReload(window.sessionStorage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(consumeGithubAuthRecovery(window.sessionStorage)).toBe(true);
    expect(consumeGithubAuthRecovery(window.sessionStorage)).toBe(false);

    expect(requestGithubAuthRecoveryReload(window.sessionStorage, reload)).toBe(true);
    clearGithubAuthRecovery(window.sessionStorage);
    expect(consumeGithubAuthRecovery(window.sessionStorage)).toBe(false);
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
    expect(render).toHaveBeenCalledWith(first, expect.objectContaining({ size: "flexible" }));
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
        callbackURL: "/wilhelm/Svalbard/Pyramiden?layer=terrain&auth-return=github#profile",
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

  it("uses a caller-owned challenge container without moving or removing it", async () => {
    const host = document.createElement("section");
    const container = document.createElement("div");
    host.append(container);
    document.body.append(host);
    const getToken = vi.fn(async () => "fresh-token");
    const signIn = createGithubPilotSignIn({
      siteKey: "site-key",
      getToken,
      social: vi.fn(async () => ({
        data: { url: "https://github.com/login/oauth/authorize?client_id=test" },
        error: null,
      })),
      navigate: vi.fn(),
    });

    await expect(signIn(window.location, container)).resolves.toBe("started");
    expect(getToken).toHaveBeenCalledWith(container);
    expect(container.parentElement).toBe(host);
    expect(container.style.position).toBe("");
    expect(container).toHaveAttribute("aria-label", "Anti-bot check");
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

  it("suppresses duplicate passkey sign-in and returns control without navigation", async () => {
    let release!: (value: { data: { user: { id: string } }; error: null }) => void;
    const passkey = vi.fn(() => new Promise<{ data: { user: { id: string } }; error: null }>((resolve) => { release = resolve; }));
    const signIn = createPasskeyPilotSignIn({ passkey });

    const first = signIn();
    await expect(signIn()).resolves.toBe("busy");
    release({ data: { user: { id: "auth-1" } }, error: null });
    await expect(first).resolves.toBe("signed-in");
    expect(window.location.pathname).toBe("/wilhelm/Svalbard/Pyramiden");
  });

  it("preserves the library passkey error code for safe GitHub fallback decisions", async () => {
    const signIn = createPasskeyPilotSignIn({
      passkey: vi.fn(async () => ({
        data: null,
        error: { code: "ERROR_CEREMONY_ABORTED", message: "Auth cancelled", status: 400 },
      })),
    });
    await expect(signIn()).rejects.toMatchObject({
      name: "PasskeyPilotError",
      code: "ERROR_CEREMONY_ABORTED",
      status: 400,
    });
  });

  it("turns browser transport failures into an actionable passkey sign-in message", () => {
    expect(getPasskeyUiErrorMessage(new TypeError("Load failed"), "sign-in")).toBe(
      "Passkey sign-in could not reach LinkSim. Reload the page and try again, or sign in with GitHub.",
    );
    expect(getPasskeyUiErrorMessage(new TypeError("Failed to fetch"), "load")).toBe(
      "LinkSim could not load your passkeys. Reload the page and try again.",
    );
  });

  it("sanitizes GitHub initiation failures and always gives a recovery action", () => {
    expect(getGithubSignInUiErrorMessage(new TypeError("Load failed"))).toBe(
      "GitHub sign-in could not reach LinkSim. Check your connection, reload the page, and try again.",
    );
    expect(getGithubSignInUiErrorMessage(new Error("database connection string leaked"))).toBe(
      "GitHub sign-in could not start. Try again. If the problem continues, reload the page.",
    );
  });

  it("explains stale sessions and cancelled passkey ceremonies", () => {
    expect(getPasskeyUiErrorMessage(new PasskeyPilotError("Session is not fresh", undefined, 403), "remove")).toBe(
      "Your sign-in is too old to remove the passkey. Sign out, sign in with GitHub again, and retry within five minutes.",
    );
    expect(getPasskeyUiErrorMessage(
      new PasskeyPilotError("Auth cancelled", "ERROR_CEREMONY_ABORTED", 400),
      "sign-in",
    )).toBe(
      "Passkey sign-in was cancelled or no matching passkey is available. Try again, or sign in with GitHub.",
    );
  });

  it("explains cancelled and unsupported passkey creation without implying success", () => {
    expect(getPasskeyUiErrorMessage(
      new PasskeyPilotError("Auth cancelled", "ERROR_CEREMONY_ABORTED", 400),
      "add",
    )).toBe("Passkey creation was cancelled. No passkey was added. Try again when ready.");
    expect(getPasskeyUiErrorMessage(new Error("WebAuthn is not supported"), "add")).toBe(
      "This browser or device could not create a passkey. Try a current browser with screen lock enabled.",
    );
  });

  it("keeps unknown passkey failures useful without exposing internal text", () => {
    expect(getPasskeyUiErrorMessage(new Error("database connection string leaked"), "add")).toBe(
      "LinkSim could not add the passkey. Try again. If the problem continues, sign out and sign in with GitHub.",
    );
  });

  it("lists and mutates only the selected passkey through library actions", async () => {
    const actions = {
      listUserPasskeys: vi.fn(async () => ({
        data: [{
          id: "key-1",
          name: "Laptop",
          createdAt: new Date(0),
          publicKey: "must-not-reach-ui",
          credentialID: "must-not-reach-ui",
        }],
        error: null,
      })),
      addPasskey: vi.fn(async () => ({ data: {}, error: null })),
      updatePasskey: vi.fn(async () => ({ data: {}, error: null })),
      deletePasskey: vi.fn(async () => ({ data: {}, error: null })),
    };
    const management = createPasskeyManagement(actions as never);
    await expect(management.list()).resolves.toEqual([{ id: "key-1", name: "Laptop", createdAt: new Date(0) }]);
    await management.add(" Phone ");
    await management.rename("key-1", " Laptop 2 ");
    await management.remove("key-1");
    expect(actions.addPasskey).toHaveBeenCalledWith({ name: "Phone" });
    expect(actions.updatePasskey).toHaveBeenCalledWith({ id: "key-1", name: "Laptop 2" });
    expect(actions.deletePasskey).toHaveBeenCalledWith({ id: "key-1" });
  });
});
