import { handleOptions, json, withCors } from "../_lib/http";
import type { Env } from "../_lib/types";
import { APP_BUILD_LABEL, APP_COMMIT, APP_VERSION } from "../_lib/buildInfo";

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => handleOptions(request);

const PROD_HOSTS = new Set(["linksim.link", "linksim.wilhelmfrancke.com", "linksim.pages.dev"]);

const normalizeHost = (host: string): string => host.trim().toLowerCase();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) =>
  withCors(
    request,
    (() => {
      const url = new URL(request.url);
      const host = normalizeHost(url.hostname);
      const envName = PROD_HOSTS.has(host) ? "production" : "test";
      return json({
        ok: true,
        service: "linksim-api",
        ts: new Date().toISOString(),
        build: {
          version: APP_VERSION,
          commit: APP_COMMIT,
          label: APP_BUILD_LABEL,
        },
        runtime: {
          env: envName,
          host,
          pagesUrl: env.CF_PAGES_URL ?? null,
          pagesBranch: env.CF_PAGES_BRANCH ?? null,
          pagesCommitSha: env.CF_PAGES_COMMIT_SHA ?? null,
        },
      });
    })(),
  );
