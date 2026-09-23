import { verifyFreshAccessJwt } from "../../../_lib/auth";
import {
  LegacyAuthMigrationError,
  PRIVILEGED_PASSKEY_RECOVERY_COOKIE,
  claimPrivilegedPasskeyRecovery,
  createLegacyAuthMigrationAttempt,
} from "../../../_lib/authIdentityMap";
import { json } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

const hardened = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
};

const safeReturnTo = (raw: string | null, origin: string) => {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return new URL("/", origin);
  try {
    const target = new URL(raw, origin);
    return target.origin === origin ? target : new URL("/", origin);
  } catch {
    return new URL("/", origin);
  }
};

type StartContext = { request: Request; env: Env };
type StartDependencies = {
  now: () => Date;
  randomUUID: () => string;
  verifyFreshAccessJwt: typeof verifyFreshAccessJwt;
};

const defaults: StartDependencies = {
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  verifyFreshAccessJwt,
};

export const handleLegacyAccessStart = async (
  { request, env }: StartContext,
  dependencies: StartDependencies = defaults,
) => {
  if (env.AUTH_DUAL_LOGIN_MIGRATION_ENABLED !== "true") {
    return hardened(json({ code: "MIGRATION_DISABLED", error: "Account migration is unavailable." }, { status: 404 }));
  }
  const requestURL = new URL(request.url);
  const returnTo = safeReturnTo(requestURL.searchParams.get("returnTo"), requestURL.origin);
  const passkeyRecovery = requestURL.searchParams.get("recovery") === "passkey";
  if (passkeyRecovery && env.AUTH_PRIVILEGED_PASSKEY_RECOVERY_ENABLED !== "true") {
    return hardened(json({ code: "RECOVERY_DISABLED", error: "Administrator passkey recovery is unavailable." }, { status: 404 }));
  }
  if (passkeyRecovery && requestURL.searchParams.get("reauth") !== "1") {
    const retry = new URL(requestURL);
    retry.searchParams.set("reauth", "1");
    const logout = new URL("/cdn-cgi/access/logout", requestURL.origin);
    logout.searchParams.set("returnTo", retry.toString());
    return hardened(Response.redirect(logout.toString(), 303));
  }
  const now = dependencies.now();
  const proof = await dependencies.verifyFreshAccessJwt(request, env, now.getTime());
  if (!proof) {
    if (requestURL.searchParams.get("reauth") !== "1") {
      const retry = new URL(requestURL);
      retry.searchParams.set("reauth", "1");
      const logout = new URL("/cdn-cgi/access/logout", requestURL.origin);
      logout.searchParams.set("returnTo", retry.toString());
      return hardened(Response.redirect(logout.toString(), 303));
    }
    return hardened(json({
      code: "MIGRATION_STALE",
      error: "Cloudflare Access could not provide a newly issued sign-in proof. Return to LinkSim and start account migration again.",
    }, { status: 401 }));
  }

  const attemptId = dependencies.randomUUID();
  const browserToken = passkeyRecovery ? dependencies.randomUUID() : null;
  const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString();
  try {
    await createLegacyAuthMigrationAttempt(env.DB, {
      attemptId,
      legacyUserId: proof.userId,
      accessSubject: proof.userId,
      accessIssuedAt: proof.issuedAt,
      now: now.toISOString(),
      expiresAt,
    });
    if (passkeyRecovery) {
      await claimPrivilegedPasskeyRecovery(env.DB, {
        attemptId,
        browserToken: browserToken!,
        now: now.toISOString(),
      });
    }
  } catch (error) {
    if (passkeyRecovery) {
      await env.DB.prepare("DELETE FROM auth_migration_attempt WHERE id = ? AND consumed_at IS NULL")
        .bind(attemptId).run().catch(() => undefined);
    }
    if (error instanceof LegacyAuthMigrationError) {
      return hardened(json({
        code: "MIGRATION_INELIGIBLE",
        error: "This legacy account cannot be migrated automatically. Nothing was changed; contact an administrator for review.",
      }, { status: 409 }));
    }
    return hardened(json({
      code: "MIGRATION_FAILED",
      error: "LinkSim could not start account migration. Nothing was changed; try again.",
    }, { status: 503 }));
  }

  returnTo.searchParams.set("legacyMigration", attemptId);
  if (passkeyRecovery) returnTo.searchParams.set("legacyRecovery", "passkey");
  const redirect = hardened(Response.redirect(returnTo.toString(), 303));
  if (!browserToken) return redirect;
  const headers = new Headers(redirect.headers);
  headers.append("set-cookie", `${PRIVILEGED_PASSKEY_RECOVERY_COOKIE}=${browserToken}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Strict`);
  return new Response(redirect.body, { status: redirect.status, headers });
};

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleLegacyAccessStart(context);
