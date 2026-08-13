import { describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestOptions } from "./calculate.jobs.jobId";

const makeEnv = (row: unknown = null) => {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const run = vi.fn(async () => ({ success: true }));
  const prepare = vi.fn((sql: string) => sql.startsWith("CREATE TABLE") ? { run } : { bind });
  return { env: { DB: { prepare } } as unknown as Parameters<typeof onRequestGet>[0]["env"], first };
};

describe("api/v1/calculate job status CORS", () => {
  it("keeps an originless API client free of CORS authorization headers", async () => {
    const { env } = makeEnv();
    const response = await onRequestGet({
      request: new Request("https://linksim.link/api/v1/calculate/jobs/job-1"),
      env,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("uses the shared credentialed contract for a same-origin response", async () => {
    const { env } = makeEnv({
      id: "job-1",
      status: "completed",
      input_json: "{}",
      result_json: "{\"ok\":true}",
      error_message: null,
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:01Z",
    });
    const response = await onRequestGet({
      request: new Request("https://staging.linksim.link/api/v1/calculate/jobs/job-1", {
        headers: { origin: "https://staging.linksim.link" },
      }),
      env,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://staging.linksim.link");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("uses the shared preflight policy for the local Vite exception", async () => {
    const { env } = makeEnv();
    const response = await onRequestOptions({
      request: new Request("http://127.0.0.1:8788/api/v1/calculate/jobs/job-1", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:5174",
          "access-control-request-method": "GET",
        },
      }),
      env,
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
