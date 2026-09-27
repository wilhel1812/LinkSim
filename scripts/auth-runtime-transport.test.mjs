import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { describe, expect, it } from "vitest";

const origin = "https://staging.linksim.test";

describe("staging auth Durable Object transport", () => {
  it("carries an HTTP redirect and cookies through the real private binding", async () => {
    const directory = mkdtempSync(join(tmpdir(), "linksim-auth-transport-"));
    const gatewayPath = join(directory, "gateway.js");
    const runtimePath = join(directory, "runtime.js");
    const productionGateway = readFileSync("functions/api/auth/[[path]].ts", "utf8");
    expect(productionGateway).toContain('.getByName("auth").fetch(');
    expect(productionGateway).toContain('redirect: "manual"');
    expect(productionGateway).not.toContain(".handleAuth(");
    writeFileSync(gatewayPath, `
      export default {
        async fetch(request, env) {
          const response = await env.AUTH.getByName("auth").fetch(new Request(request, {
            redirect: "manual",
          }));
          return new Response(response.body, {
            status: response.status,
            headers: response.headers,
          });
        }
      };
    `);
    writeFileSync(runtimePath, `
      export class AuthRuntime {
        async fetch() {
          const headers = new Headers({ location: "https://github.com/login/oauth/authorize" });
          headers.append("set-cookie", "first=one; Secure; HttpOnly");
          headers.append("set-cookie", "second=two; Secure; HttpOnly");
          return new Response(null, { status: 302, headers });
        }
      }
      export default { fetch() { return new Response(null, { status: 404 }); } };
    `);

    const common = {
      modules: true,
      compatibilityDate: "2026-03-12",
      compatibilityFlags: ["nodejs_compat"],
    };
    const miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [
      {
        ...common,
        name: "gateway",
        scriptPath: gatewayPath,
        modulesRoot: directory,
        durableObjects: {
          AUTH: { className: "AuthRuntime", scriptName: "runtime" },
        },
      },
      {
        ...common,
        name: "runtime",
        scriptPath: runtimePath,
        modulesRoot: directory,
        durableObjects: { AUTH: { className: "AuthRuntime" } },
      },
    ] }));

    try {
      const response = await miniflare.dispatchFetch(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin,
          "content-type": "application/json",
          "x-captcha-response": "local-turnstile-token",
        },
        body: JSON.stringify({ provider: "github" }),
      });

      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location")).hostname).toBe("github.com");
      expect(response.headers.getSetCookie()).toEqual([
        "first=one; Secure; HttpOnly",
        "second=two; Secure; HttpOnly",
      ]);
    } finally {
      await miniflare.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
