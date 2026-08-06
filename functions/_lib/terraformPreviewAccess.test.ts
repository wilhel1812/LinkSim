import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const staging = read("infra/terraform/environments/staging/terraform.tfvars");
const moduleSource = read("infra/terraform/modules/linksim_cloudflare/main.tf");

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
      'pages_access_audience_keys = ["primary", "pages_root", "pages_previews"]',
    );
    expect(moduleSource).toContain("ACCESS_AUD = join(\",\", local.managed_access_audiences)");
  });

  it("uses the same staging-only D1 and R2 variables for preview and production", () => {
    const preview = moduleSource.split("    preview = {")[1]?.split("    production = {")[0] ?? "";
    expect(preview).toContain("id = var.d1_database_id");
    expect(preview).toContain("name = var.r2_bucket_name");
  });
});
