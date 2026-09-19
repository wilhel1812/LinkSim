export type AuthSessionResultCategory = "ok" | "no-session" | "rejected" | "error";

export const makeAuthSessionLog = (
  status: number,
  result: AuthSessionResultCategory,
  elapsedMs: number,
) => ({
  event: "auth-session",
  status,
  result,
  elapsedMs: Math.max(0, Math.round(elapsedMs)),
});
