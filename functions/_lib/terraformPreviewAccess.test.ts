import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const staging = read("infra/terraform/environments/staging/terraform.tfvars");
const moduleSource = read("infra/terraform/modules/linksim_cloudflare/main.tf");
const stagingWrangler = read("wrangler.staging.toml");

const applicationBlock = (key: string): string => {
  const start = staging.indexOf(`  ${key} = {`);
  if (start < 0) return "";
  let depth = 0;
  for (let index = staging.indexOf("{", start); index < staging.length; index += 1) {
    if (staging[index] === "{") depth += 1;
    if (staging[index] === "}") depth -= 1;
    if (depth === 0) return staging.slice(start, index + 1);
  }
  return "";
};

describe("authenticated Pages preview Terraform intent", () => {
  it("models the Pages root and wildcard applications with authenticated policy", () => {
    expect(applicationBlock("authenticated_api")).toContain(
      'domain = "staging.linksim.link/api/*"',
    );
    expect(applicationBlock("pages_root")).toContain('domain = "linksim-staging.pages.dev"');
    expect(applicationBlock("pages_previews")).toContain(
      'domain = "*.linksim-staging.pages.dev"',
    );
    expect(applicationBlock("pages_root")).toContain(
      'id         = "fd96072d-843b-4320-811a-281767b011ee"',
    );
    expect(applicationBlock("pages_previews")).toContain(
      'id         = "fd96072d-843b-4320-811a-281767b011ee"',
    );
  });

  it("derives all staging audiences from the managed Access applications", () => {
    expect(staging).toContain(
      'pages_access_audience_keys = ["authenticated_api", "pages_root", "pages_previews"]',
    );
    expect(moduleSource).toContain("ACCESS_AUD = join(\",\", local.managed_access_audiences)");
    expect(stagingWrangler).toContain(
      'ACCESS_AUD = "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131,7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283,2a5d033ef624d21f08eeb36b75799b81a6fa00536f2341a2ef53301dc36bf19c"',
    );
    expect(stagingWrangler).not.toContain(
      "08eb695895482e6a14ff49332f3491d0aa02c751670d37983aa7dbbe0da16a08",
    );
    expect(staging).toContain('REGISTRATION_MODE                               = "open"');
    expect(stagingWrangler).toContain('REGISTRATION_MODE = "open"');
  });

  it("uses the same staging-only D1 and R2 variables for preview and production", () => {
    const preview = moduleSource.split("    preview = {")[1]?.split("    production = {")[0] ?? "";
    expect(preview).toContain("id = var.d1_database_id");
    expect(preview).toContain("name = var.r2_bucket_name");
    expect(moduleSource).not.toContain("ignore_changes  = [deployment_configs]");
    expect(moduleSource).toContain("deployment_configs.preview.wrangler_config_hash");
    expect(moduleSource).toContain(
      'deployment_configs.preview.env_vars["VITE_MAPTILER_KEY"].value',
    );
  });
});
