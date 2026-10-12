import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("Cloudflare discovery output privacy", () => {
  it("keeps inventory in the requested file and excludes configuration from console output", () => {
    const dir = mkdtempSync(join(tmpdir(), "linksim-discovery-"));
    try {
      const stub = join(dir, "fetch.mjs");
      writeFileSync(stub, `globalThis.fetch = async () => ({ json: async () => ({ success: false, errors: [{ code: 1, message: 'provider_private_marker' }] }) });`);
      const file = join(dir, "inventory.json");
      const output = execFileSync(process.execPath, ["--import", stub, resolve("infra/terraform/scripts/discover-cloudflare.mjs"), "staging", file], {
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "account_private_marker", CLOUDFLARE_ZONE_NAME: "zone_private_marker", CLOUDFLARE_API_TOKEN: "token_private_marker" },
        encoding: "utf8",
      });
      expect(output).not.toContain("private_marker");
      const inventory = JSON.parse(readFileSync(file, "utf8"));
      expect(inventory.account_id).toBe("account_private_marker");
      expect(inventory.zone_name).toBe("zone_private_marker");
      expect(readFileSync(file, "utf8")).not.toContain("token_private_marker");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
