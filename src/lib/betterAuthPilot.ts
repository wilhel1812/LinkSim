import { createAuthClient } from "better-auth/client";

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACTION = "github-login";
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const TURNSTILE_INTERACTION_TIMEOUT_MS = 120_000;

type PilotEnvironment = {
  VITE_BETTER_AUTH_PILOT?: string;
  VITE_TURNSTILE_SITE_KEY?: string;
};

type TurnstileWidgetOptions = {
  sitekey: string;
  action: string;
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
  input: { provider: "github"; callbackURL: string; errorCallbackURL: string },
  options: { headers: { "x-captcha-response": string } },
) => Promise<{ data?: unknown; error?: { message?: string } | null }>;

let turnstileLoading: Promise<TurnstileApi> | undefined;
let authClient: ReturnType<typeof createAuthClient> | undefined;

const getAuthClient = () => {
  authClient ??= createAuthClient({
    baseURL: window.location.origin,
    fetchOptions: { timeout: 20_000, retry: 0 },
  });
  return authClient;
};

export const isBetterAuthPilotEnabled = (env: PilotEnvironment = import.meta.env): boolean =>
  env.VITE_BETTER_AUTH_PILOT === "true" && Boolean(env.VITE_TURNSTILE_SITE_KEY?.trim());

export const buildAuthReturnPath = (location: Pick<Location, "pathname" | "search" | "hash">): string => {
  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  return returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
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

const checked = <T>(response: { data?: T; error?: { message?: string } | null }): T | undefined => {
  if (response.error) throw new Error(response.error.message || "Authentication request failed");
  return response.data;
};

export const createGithubPilotSignIn = (dependencies: {
  siteKey: string;
  getToken?: typeof getTurnstileToken;
  social?: SocialSignIn;
  createContainer?: () => HTMLElement;
}) => {
  let busy = false;
  return async (location: Pick<Location, "pathname" | "search" | "hash">): Promise<"started" | "busy"> => {
    if (busy) return "busy";
    busy = true;
    const container = (dependencies.createContainer ?? (() => document.createElement("div")))();
    container.dataset.sitekey = dependencies.siteKey;
    container.setAttribute("aria-label", "Anti-bot check");
    container.style.position = "fixed";
    container.style.left = "50%";
    container.style.top = "50%";
    container.style.transform = "translate(-50%, -50%)";
    container.style.zIndex = "10000";
    document.body.append(container);
    try {
      const token = await (dependencies.getToken ?? getTurnstileToken)(container);
      const returnPath = buildAuthReturnPath(location);
      const social = dependencies.social ?? (getAuthClient().signIn.social as SocialSignIn);
      checked(await social(
        { provider: "github", callbackURL: returnPath, errorCallbackURL: returnPath },
        { headers: { "x-captcha-response": token } },
      ));
      return "started";
    } finally {
      container.remove();
      busy = false;
    }
  };
};

const pilotSignIn = createGithubPilotSignIn({
  siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "",
});

export const signInWithGithubPilot = (location: Pick<Location, "pathname" | "search" | "hash">) =>
  pilotSignIn(location);

export const signOutBetterAuthPilot = async (): Promise<void> => {
  checked(await getAuthClient().signOut());
};
