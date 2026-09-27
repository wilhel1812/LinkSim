import { describe, expect, it } from "vitest";
import { ensureUser } from "./db";

describe("identity lifecycle runtime schema gate", () => {
  it("does not enter legacy account creation or reconciliation for a mapped Better Auth identity", async () => {
    const env = {
      DB: {
        prepare: () => { throw new Error("legacy database path must not run"); },
        batch: async () => { throw new Error("legacy database path must not run"); },
      } as unknown as D1Database,
    };

    await expect(ensureUser(env, "linksim-1", {
      __linksim_better_auth_mapped: true,
    })).resolves.toBeUndefined();
  });

  it("fails before any mutation when the migration marker is absent", async () => {
    let batchCalled = false;
    const statement = {
      bind() { return this; },
      async all() { return { results: [] }; },
      async first() { return null; },
      async run() { throw new Error("runtime mutation must not run"); },
    };
    const env = {
      DB: {
        prepare: () => statement,
        batch: async () => {
          batchCalled = true;
          throw new Error("runtime batch must not run");
        },
      } as unknown as D1Database,
    };

    await expect(ensureUser(env, "subject", {
      __linksim_verified_idp_email: "user@example.com",
    })).rejects.toThrow("identity lifecycle D1 migration");
    expect(batchCalled).toBe(false);
  });
});
