import { getClientAddress, takeRateLimitToken } from "../../_lib/rateLimit";
import { errorResponse, handleOptions, json, withCors } from "../../_lib/http";
import type { Env } from "../../_lib/types";

type Context = {
  request: Request;
  env: Env;
};

const parsePerMinuteLimit = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const copyRelevantHeaders = (source: Headers): Headers => {
  const target = new Headers();
  const contentType = source.get("content-type");
  if (contentType) target.set("content-type", contentType);
  const retryAfter = source.get("retry-after");
  if (retryAfter) target.set("retry-after", retryAfter);
  return target;
};

export const onRequestOptions = async ({ request }: Context) => handleOptions(request);

export const onRequestPost = async ({ request, env }: Context) => {
  try {
    const upstreamBaseUrl = (env.CALC_API_BASE_URL ?? "").trim();
    if (!upstreamBaseUrl) {
      return withCors(
        request,
        json(
          { error: "Calculation API is not configured." },
          {
            status: 503,
          },
        ),
      );
    }

    const limitPerMinute = parsePerMinuteLimit(env.CALC_API_PROXY_RATE_LIMIT_PER_MINUTE, 120);
    const address = getClientAddress(request);
    const limiter = takeRateLimitToken({ key: `calc-api:${address}`, limit: limitPerMinute });
    if (!limiter.allowed) {
      return withCors(
        request,
        json(
          { error: "Calculation API rate limit reached. Please wait and try again." },
          {
            status: 429,
            headers: {
              "retry-after": String(limiter.retryAfterSec),
            },
          },
        ),
      );
    }

    const payload = await request.text();
    const upstreamUrl = new URL("/api/v1/calculate", upstreamBaseUrl).toString();
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        accept: request.headers.get("accept") ?? "application/json",
      },
      body: payload,
    });

    const responseText = await upstreamResponse.text();
    return withCors(
      request,
      new Response(responseText, {
        status: upstreamResponse.status,
        headers: copyRelevantHeaders(upstreamResponse.headers),
      }),
    );
  } catch (error) {
    return errorResponse(request, error, 502);
  }
};
