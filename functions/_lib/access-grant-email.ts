import type { Env, UserRole } from "./types";

type AccessGrantEmailInput = {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
  approvedByUserId: string;
};

const isLikelyPlaceholderEmail = (email: string): boolean => {
  const trimmed = email.trim().toLowerCase();
  return (
    !trimmed ||
    trimmed === "unknown@users.linksim.local" ||
    trimmed.endsWith("@users.linksim.local") ||
    trimmed.endsWith("@example.invalid")
  );
};

export const sendAccessGrantedEmail = async (
  env: Env,
  input: AccessGrantEmailInput,
): Promise<{ sent: boolean; reason?: string }> => {
  const webhook = (env.ACCESS_GRANTED_EMAIL_WEBHOOK_URL ?? "").trim();
  if (!webhook) return { sent: false, reason: "access-grant email webhook not configured" };

  const toEmail = input.email.trim();
  if (isLikelyPlaceholderEmail(toEmail)) {
    return { sent: false, reason: "user email missing or placeholder" };
  }

  const appUrl =
    (env.APP_BASE_URL ?? "").trim() ||
    (env.CF_PAGES_URL ? `https://${env.CF_PAGES_URL}` : "https://linksim.pages.dev");
  const roleLabel = input.role === "admin" ? "Admin" : input.role === "moderator" ? "Moderator" : "User";
  const payload = {
    event: "access_granted",
    to: toEmail,
    userId: input.userId,
    username: input.username,
    role: input.role,
    subject: `LinkSim access approved (${roleLabel})`,
    text: `Hi ${input.username}, your LinkSim access has been approved with role: ${roleLabel}. Open: ${appUrl}`,
    appUrl,
    approvedByUserId: input.approvedByUserId,
    timestamp: new Date().toISOString(),
  };

  const headers: Record<string, string> = { "content-type": "application/json" };
  const bearer = (env.ACCESS_GRANTED_EMAIL_WEBHOOK_BEARER ?? "").trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  const response = await fetch(webhook, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { sent: false, reason: `webhook ${response.status}` };
  }
  return { sent: true };
};
