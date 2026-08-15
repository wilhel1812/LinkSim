import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import { boundedJobError, ensureCalculationJobsTable, getAddressedCalculationJob, JOB_STATUS } from "../../_lib/calculationJobs";
import type { Env } from "../../_lib/types";

type Context = { request: Request; env: Env };

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestGet = async ({ request, env }: Context) => {
  const jobId = new URL(request.url).pathname.split("/").pop();
  if (!jobId) return withCors(request, json({ error: "Job ID is required." }, { status: 400 }));
  try {
    await ensureCalculationJobsTable(env);
    const job = await getAddressedCalculationJob(env, jobId);
    if (!job) return withCors(request, json({ error: "Job not found." }, { status: 404 }));
    const response: Record<string, unknown> = { job_id: job.id, status: job.status, created_at: job.created_at, updated_at: job.updated_at };
    if (job.status === JOB_STATUS.COMPLETED && job.result_json) {
      try { response.result = JSON.parse(job.result_json); } catch { response.result = job.result_json; }
    }
    if (job.status === JOB_STATUS.FAILED && job.error_message) response.error = boundedJobError(job.error_message);
    if (job.status === JOB_STATUS.TIMED_OUT) response.error = "Job timed out before completion.";
    return withCors(request, json(response));
  } catch (error) { return errorResponse(request, error, 500); }
};
