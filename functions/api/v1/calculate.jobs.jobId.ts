import { handleOptions, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

type Context = {
  request: Request;
  env: Env;
};

const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
} as const;

const ensureCalculationJobsTable = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS calculation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', input_json TEXT NOT NULL, result_json TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
};

const getJob = async (env: Env, jobId: string) => {
  const stmt = env.DB.prepare(
    "SELECT id, status, input_json, result_json, error_message, created_at, updated_at FROM calculation_jobs WHERE id = ?",
  );
  const row = await stmt.bind(jobId).first<{
    id: string;
    status: string;
    input_json: string;
    result_json: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>();
  return row;
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestGet = async ({ request, env }: Context) => {
  const url = new URL(request.url);
  const jobId = url.pathname.split("/").pop();

  if (!jobId) {
    return withCors(request, new Response(JSON.stringify({ error: "Job ID is required." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));
  }

  try {
    await ensureCalculationJobsTable(env);
    const job = await getJob(env, jobId);

    if (!job) {
      return withCors(request, new Response(
        JSON.stringify({ error: "Job not found." }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      ));
    }

    const response: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };

    if (job.status === JOB_STATUS.COMPLETED && job.result_json) {
      try {
        response.result = JSON.parse(job.result_json);
      } catch {
        response.result = job.result_json;
      }
    }

    if (job.status === JOB_STATUS.FAILED && job.error_message) {
      response.error = job.error_message;
    }

    if (job.status === JOB_STATUS.TIMED_OUT) {
      response.error = "Job timed out before completion.";
    }

    return withCors(request, new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return withCors(request, new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    ));
  }
};
