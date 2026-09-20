import { createAuthClient } from "better-auth/client";
import { passkeyClient, type Passkey } from "@better-auth/passkey/client";

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACTION = "github-login";
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const TURNSTILE_INTERACTION_TIMEOUT_MS = 120_000;
const GITHUB_AUTH_RETURN_PARAM = "auth-return";
const GITHUB_AUTH_RECOVERY_KEY = "linksim:github-auth-return-reload:v1";

type PilotEnvironment = {
  VITE_BETTER_AUTH_PILOT?: string;
  VITE_TURNSTILE_SITE_KEY?: string;
};

type TurnstileWidgetOptions = {
  sitekey: string;
  action: string;
  size: "flexible";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileWidgetOptions) => string | number;
  remove: (widget: string | number) => void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };
type SocialSignIn = (
  input: {
    provider: "github";
    callbackURL: string;
    errorCallbackURL: string;
    disableRedirect: true;
  },
  options: { headers: { "x-captcha-response": string } },
) => Promise<{
  data?: { url?: string | null } | null;
  error?: { message?: string } | null;
}>;

type AuthResponse<T> = {
  data?: T | null;
  error?: { code?: string; message?: string; status?: number } | null;
};

type PasskeySignIn = () => Promise<AuthResponse<{ user: { id: string } }>>;
type PasskeyActions = {
  listUserPasskeys: () => Promise<AuthResponse<Passkey[]>>;
  addPasskey: (input: { name: string }) => Promise<AuthResponse<unknown>>;
  updatePasskey: (input: { id: string; name: string }) => Promise<AuthResponse<unknown>>;
  deletePasskey: (input: { id: string }) => Promise<AuthResponse<unknown>>;
};

export type BetterAuthPasskey = Pick<Passkey, "id" | "name" | "createdAt">;

export const getGithubSignInUiErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (/^(?:load failed|failed to fetch|networkerror\b)/iu.test(message)) {
    return "GitHub sign-in could not reach LinkSim. Check your connection, reload the page, and try again.";
  }
  if (/anti-bot|turnstile|captcha/iu.test(message)) {
    return "GitHub sign-in could not complete the anti-bot check. Reload the page and try again.";
  }
  return "GitHub sign-in could not start. Try again. If the problem continues, reload the page.";
};

export class PasskeyPilotError extends Error {
  readonly name = "PasskeyPilotError";
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type PasskeyOperation = "sign-in" | "load" | "add" | "rename" | "remove";

const passkeyAction = (operation: PasskeyOperation): string => {
  switch (operation) {
    case "sign-in": return "sign in with a passkey";
    case "load": return "load your passkeys";
    case "add": return "add the passkey";
    case "rename": return "rename the passkey";
    case "remove": return "remove the passkey";
  }
};

export const getPasskeyUiErrorMessage = (error: unknown, operation: PasskeyOperation): string => {
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  const code = error instanceof PasskeyPilotError ? error.code : undefined;
  const status = error instanceof PasskeyPilotError ? error.status : undefined;

  if (/^(?:load failed|failed to fetch|networkerror\b)/iu.test(message)) {
    return operation === "sign-in"
      ? "Passkey sign-in could not reach LinkSim. Reload the page and try again, or sign in with GitHub."
      : operation === "load"
        ? "LinkSim could not load your passkeys. Reload the page and try again."
        : `LinkSim could not ${passkeyAction(operation)}. Check your connection, reload the page, and try again.`;
  }
  if (/session is not fresh/iu.test(message)) {
    return `Your sign-in is too old to ${passkeyAction(operation)}. Sign out, sign in with GitHub again, and retry within five minutes.`;
  }
  if (status === 401 && operation !== "sign-in") {
    return `You are no longer signed in, so LinkSim could not ${passkeyAction(operation)}. Sign in with GitHub and try again.`;
  }
  if (operation === "sign-in" && (
    code === "ERROR_CEREMONY_ABORTED"
    || /(?:notallowederror|cancelled|canceled|timed out|no credentials?)/iu.test(message)
  )) {
    return "Passkey sign-in was cancelled or no matching passkey is available. Try again, or sign in with GitHub.";
  }
  if (operation === "add" && (
    code === "ERROR_CEREMONY_ABORTED"
    || /(?:notallowederror|cancelled|canceled|timed out)/iu.test(message)
  )) {
    return "Passkey creation was cancelled. No passkey was added. Try again when ready.";
  }
  if (operation === "sign-in" && /(?:webauthn|passkeys? (?:are|is) not supported)/iu.test(message)) {
    return "This browser or device could not use passkeys. Try a current browser with screen lock enabled, or sign in with GitHub.";
  }
  if (operation === "add" && /(?:webauthn|passkeys? (?:are|is) not supported)/iu.test(message)) {
    return "This browser or device could not create a passkey. Try a current browser with screen lock enabled.";
  }
  if (operation === "sign-in") {
    return "LinkSim could not sign in with the passkey. Try again, or sign in with GitHub.";
  }
  return `LinkSim could not ${passkeyAction(operation)}. Try again. If the problem continues, sign out and sign in with GitHub.`;
};

let turnstileLoading: Promise<TurnstileApi> | undefined;
const createPilotAuthClient = () => createAuthClient({
  baseURL: window.location.origin,
  plugins: [passkeyClient()],
  fetchOptions: { timeout: 20_000, retry: 0 },
});
let authClient: ReturnType<typeof createPilotAuthClient> | undefined;

const getAuthClient = () => {
  authClient ??= createPilotAuthClient();
  return authClient;
};

export const isBetterAuthPilotEnabled = (env: PilotEnvironment = import.meta.env): boolean =>
  env.VITE_BETTER_AUTH_PILOT === "true" && Boolean(env.VITE_TURNSTILE_SITE_KEY?.trim());

export const buildAuthReturnPath = (location: Pick<Location, "pathname" | "search" | "hash">): string => {
  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  return returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
};

export const buildGithubAuthReturnPath = (
  location: Pick<Location, "pathname" | "search" | "hash">,
): string => {
  const returnPath = buildAuthReturnPath(location);
  const url = new URL(returnPath, "https://linksim.invalid");
  url.searchParams.set(GITHUB_AUTH_RETURN_PARAM, "github");
  return `${url.pathname}${url.search}${url.hash}`;
};

export const consumeGithubAuthReturn = (
  location: Pick<Location, "href" | "origin">,
  history: Pick<History, "replaceState">,
): boolean => {
  const url = new URL(location.href, location.origin);
  if (url.searchParams.get(GITHUB_AUTH_RETURN_PARAM) !== "github") return false;
  url.searchParams.delete(GITHUB_AUTH_RETURN_PARAM);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
};

export const clearGithubAuthRecovery = (storage: Pick<Storage, "removeItem"> = window.sessionStorage): void => {
  try {
    storage.removeItem(GITHUB_AUTH_RECOVERY_KEY);
  } catch {
    // Session storage can be unavailable in locked-down browsers.
  }
};

export const consumeGithubAuthRecovery = (
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
): boolean => {
  try {
    if (storage.getItem(GITHUB_AUTH_RECOVERY_KEY) !== "pending") return false;
    storage.removeItem(GITHUB_AUTH_RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
};

export const requestGithubAuthRecoveryReload = (
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean => {
  try {
    storage.setItem(GITHUB_AUTH_RECOVERY_KEY, "pending");
  } catch {
    return false;
  }
  reload();
  return true;
};

export const consumeAuthCallbackError = (
  location: Pick<Location, "href" | "origin">,
  history: Pick<History, "replaceState">,
): boolean => {
  const url = new URL(location.href, location.origin);
  if (!url.searchParams.has("error")) return false;
  for (const key of ["error", "error_code", "error_description", "error_uri"]) {
    url.searchParams.delete(key);
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
};

const loadTurnstile = (): Promise<TurnstileApi> => {
  const target = window as TurnstileWindow;
  if (target.turnstile) return Promise.resolve(target.turnstile);
  if (!turnstileLoading) {
    turnstileLoading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        script.remove();
        reject(new Error("Anti-bot check could not load. Try again."));
      }, TURNSTILE_LOAD_TIMEOUT_MS);
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timer);
        if (!target.turnstile) {
          reject(new Error("Anti-bot check unavailable."));
          return;
        }
        resolve(target.turnstile);
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        script.remove();
        reject(new Error("Anti-bot check could not load. Try again."));
      };
      document.head.append(script);
    }).catch((error) => {
      turnstileLoading = undefined;
      throw error;
    });
  }
  return turnstileLoading;
};

export const getTurnstileToken = async (
  container: HTMLElement,
  options: { load?: () => Promise<TurnstileApi>; timeoutMs?: number } = {},
): Promise<string> => {
  const sitekey = container.dataset.sitekey?.trim();
  if (!sitekey) throw new Error("Anti-bot check is not configured.");
  const api = await (options.load ?? loadTurnstile)();
  let widget: string | number | undefined;
  let timer: number | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = window.setTimeout(
        () => reject(new Error("Anti-bot check timed out. Try again.")),
        options.timeoutMs ?? TURNSTILE_INTERACTION_TIMEOUT_MS,
      );
      widget = api.render(container, {
        sitekey,
        action: TURNSTILE_ACTION,
        size: "flexible",
        callback: (token) => token ? resolve(token) : reject(new Error("Anti-bot check returned no token.")),
        "error-callback": () => {
          reject(new Error("Anti-bot check failed. Try again."));
          return true;
        },
        "expired-callback": () => reject(new Error("Anti-bot check expired. Try again.")),
        "timeout-callback": () => reject(new Error("Anti-bot check timed out. Try again.")),
      });
    });
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    if (widget !== undefined) api.remove(widget);
  }
};

const checked = <T>(response: AuthResponse<T>): T | undefined => {
  if (response.error) {
    throw new PasskeyPilotError(
      response.error.message || "Authentication request failed",
      response.error.code,
      response.error.status,
    );
  }
  return response.data ?? undefined;
};

const githubAuthorizationUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export const createGithubPilotSignIn = (dependencies: {
  siteKey: string;
  getToken?: typeof getTurnstileToken;
  social?: SocialSignIn;
  navigate?: (url: string) => void;
  createContainer?: () => HTMLElement;
}) => {
  let busy = false;
  return async (
    location: Pick<Location, "pathname" | "search" | "hash">,
    challengeContainer?: HTMLElement,
  ): Promise<"started" | "busy"> => {
    if (busy) return "busy";
    busy = true;
    const ownsContainer = !challengeContainer;
    const container = challengeContainer
      ?? (dependencies.createContainer ?? (() => document.createElement("div")))();
    container.dataset.sitekey = dependencies.siteKey;
    container.setAttribute("aria-label", "Anti-bot check");
    if (ownsContainer) {
      container.style.position = "fixed";
      container.style.left = "50%";
      container.style.top = "50%";
      container.style.transform = "translate(-50%, -50%)";
      container.style.zIndex = "10000";
      document.body.append(container);
    }
    try {
      const token = await (dependencies.getToken ?? getTurnstileToken)(container);
      const returnPath = buildAuthReturnPath(location);
      const social = dependencies.social ?? (getAuthClient().signIn.social as SocialSignIn);
      const data = checked(await social(
        {
          provider: "github",
          callbackURL: buildGithubAuthReturnPath(location),
          errorCallbackURL: returnPath,
          disableRedirect: true,
        },
        { headers: { "x-captcha-response": token } },
      ));
      const authorizationUrl = githubAuthorizationUrl(data?.url);
      if (!authorizationUrl) {
        throw new Error("GitHub sign-in did not return a valid authorization URL.");
      }
      (dependencies.navigate ?? ((url) => window.location.assign(url)))(authorizationUrl);
      return "started";
    } finally {
      if (ownsContainer) container.remove();
      busy = false;
    }
  };
};

const pilotSignIn = createGithubPilotSignIn({
  siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "",
});

export const signInWithGithubPilot = (
  location: Pick<Location, "pathname" | "search" | "hash">,
  challengeContainer?: HTMLElement,
) => pilotSignIn(location, challengeContainer);

export const createPasskeyPilotSignIn = (dependencies: { passkey?: PasskeySignIn } = {}) => {
  let busy = false;
  return async (): Promise<"signed-in" | "busy"> => {
    if (busy) return "busy";
    busy = true;
    try {
      const passkey = dependencies.passkey ?? (() => getAuthClient().signIn.passkey());
      const result = checked(await passkey());
      if (!result?.user?.id) throw new PasskeyPilotError("Passkey sign-in failed.");
      return "signed-in";
    } finally {
      busy = false;
    }
  };
};

const pilotPasskeySignIn = createPasskeyPilotSignIn();

export const signInWithPasskeyPilot = () => pilotPasskeySignIn();

export const createPasskeyManagement = (passkey: PasskeyActions) => ({
  async list(): Promise<BetterAuthPasskey[]> {
    return (checked(await passkey.listUserPasskeys()) ?? []).map(({ id, name, createdAt }) => ({
      id,
      name,
      createdAt,
    }));
  },
  async add(name: string): Promise<void> {
    checked(await passkey.addPasskey({ name: name.trim() }));
  },
  async rename(id: string, name: string): Promise<void> {
    checked(await passkey.updatePasskey({ id, name: name.trim() }));
  },
  async remove(id: string): Promise<void> {
    checked(await passkey.deletePasskey({ id }));
  },
});

const passkeyManagement = () => createPasskeyManagement(getAuthClient().passkey);

export const listBetterAuthPasskeys = () => passkeyManagement().list();
export const addBetterAuthPasskey = (name: string) => passkeyManagement().add(name);
export const renameBetterAuthPasskey = (id: string, name: string) => passkeyManagement().rename(id, name);
export const removeBetterAuthPasskey = (id: string) => passkeyManagement().remove(id);

export const signOutBetterAuthPilot = async (): Promise<void> => {
  checked(await getAuthClient().signOut());
};
