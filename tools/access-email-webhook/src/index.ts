export interface Env {
  WEBHOOK_BEARER: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
}

type AccessGrantedPayload = {
  event?: string;
  to?: string;
  userId?: string;
  username?: string;
  role?: string;
  subject?: string;
  text?: string;
  appUrl?: string;
  approvedByUserId?: string;
  timestamp?: string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const safe = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${safe(env.WEBHOOK_BEARER)}`;
    if (!safe(env.WEBHOOK_BEARER) || authHeader !== expected) {
      return json(401, { error: "Unauthorized" });
    }

    let payload: AccessGrantedPayload;
    try {
      payload = (await request.json()) as AccessGrantedPayload;
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const to = safe(payload.to);
    if (!to || !to.includes("@")) {
      return json(400, { error: "Missing valid recipient" });
    }

    const subject = safe(payload.subject) || "LinkSim access update";
    const text =
      safe(payload.text) ||
      `Hi ${safe(payload.username) || "there"}, your LinkSim access has been updated.`;

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${safe(env.RESEND_API_KEY)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: safe(env.FROM_EMAIL),
        to: [to],
        subject,
        text,
      }),
    });

    if (!resendResp.ok) {
      const msg = await resendResp.text();
      return json(502, { error: "Resend failed", status: resendResp.status, detail: msg });
    }

    const resendBody = await resendResp.json<unknown>();
    return json(200, { ok: true, provider: "resend", result: resendBody });
  },
};
