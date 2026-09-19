import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const staging = read("infra/terraform/environments/staging/terraform.tfvars");
const production = read("infra/terraform/environments/prod/terraform.tfvars");
const moduleSource = read("infra/terraform/modules/linksim_cloudflare/main.tf");
const stagingWrangler = read("wrangler.staging.toml");
const previewWrangler = read("wrangler.staging-preview.toml");
const productionWrangler = read("wrangler.toml");
const deployScript = read("scripts/deploy-pages-safe.mjs");
const deployWorkflow = read(".github/workflows/deploy-pages.yml");
const stagingTerraformMain = read("infra/terraform/environments/staging/main.tf");
const productionTerraformMain = read("infra/terraform/environments/prod/main.tf");
const terraformVariables = read("infra/terraform/modules/linksim_cloudflare/variables.tf");
const runtimeTypes = read("functions/_lib/types.ts");
const accessPolicyDocs = read("docs/access-policy-templates.md");
const authSetupDocs = read("docs/cloudflare-auth-setup.md");

const applicationBlock = (config: string, key: string): string => {
  const start = config.indexOf(`  ${key} = {`);
  if (start < 0) return "";
  let depth = 0;
  for (let index = config.indexOf("{", start); index < config.length; index += 1) {
    if (config[index] === "{") depth += 1;
    if (config[index] === "}") depth -= 1;
    if (depth === 0) return config.slice(start, index + 1);
  }
  return "";
};

describe("authenticated Pages preview Terraform intent", () => {
  it("keeps only APIs and wildcard previews authenticated on staging", () => {
    expect(applicationBlock(staging, "authenticated_api")).toContain(
      'domain = "staging.linksim.link/api/*"',
    );
    expect(applicationBlock(staging, "pages_root")).toContain('domain = "linksim-staging.pages.dev"');
    expect(applicationBlock(staging, "pages_previews")).toContain(
      'domain = "*.linksim-staging.pages.dev"',
    );
    expect(applicationBlock(staging, "pages_root")).toContain(
      'id         = "32915afb-f399-4c5c-90ea-e5bf0f377b7c"',
    );
    expect(applicationBlock(staging, "pages_previews")).toContain(
      'id         = "fd96072d-843b-4320-811a-281767b011ee"',
    );
  });

  it("derives all staging audiences from the managed Access applications", () => {
    expect(staging).toContain(
      'pages_access_audience_keys = ["authenticated_api", "pages_previews"]',
    );
    expect(moduleSource).toContain("ACCESS_AUD = join(\",\", local.managed_access_audiences)");
    expect(stagingWrangler).toContain(
      'ACCESS_AUD = "e7bccbeec1de7c76d64e9d4a30cacc726cc1d6f1eda24faaff4c563113882131,7fb6ac1a777cd646c582eeab94271601a53222c3e8a6e3ea6cc2d687cf52f283"',
    );
    expect(stagingWrangler).not.toContain(
      "2a5d033ef624d21f08eeb36b75799b81a6fa00536f2341a2ef53301dc36bf19c",
    );
    expect(stagingWrangler).not.toContain(
      "08eb695895482e6a14ff49332f3491d0aa02c751670d37983aa7dbbe0da16a08",
    );
  });

  it("does not advertise the obsolete registration mode as active configuration", () => {
    for (const source of [
      staging,
      production,
      stagingWrangler,
      productionWrangler,
      runtimeTypes,
      accessPolicyDocs,
      authSetupDocs,
    ]) {
      expect(source).not.toContain("REGISTRATION_MODE");
    }
  });

  it("models the production public-shell and authenticated-API split", () => {
    expect(applicationBlock(production, "primary")).toContain('domain = "linksim.link"');
    expect(applicationBlock(production, "primary")).toContain(
      'id         = "32915afb-f399-4c5c-90ea-e5bf0f377b7c"',
    );
    expect(applicationBlock(production, "authenticated_api")).toContain(
      'domain = "linksim.link/api/*"',
    );
    expect(applicationBlock(production, "authenticated_api")).toContain(
      'id         = "fd96072d-843b-4320-811a-281767b011ee"',
    );
    expect(production).toContain('pages_access_audience_keys = ["authenticated_api"]');
    expect(productionWrangler).toContain(
      'ACCESS_AUD = "ad63aaad91fb903f77154106fc69bb0fe7b845bfeb87ce09287b0c6dc92027b2"',
    );
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

  it("binds private history only to stable staging, never previews or production", () => {
    const preview = moduleSource.split("    preview = {")[1]?.split("    production = {")[0] ?? "";
    const stable = moduleSource.split("    production = {")[1]?.split("  lifecycle {")[0] ?? "";
    expect(stagingWrangler).toContain('binding = "HISTORY_BUCKET"');
    expect(stagingWrangler).toContain('bucket_name = "linksim-history-staging"');
    expect(stagingWrangler).toContain('HISTORY_SCOPE = "staging"');
    expect(previewWrangler).not.toContain("HISTORY_BUCKET");
    expect(previewWrangler).not.toContain("HISTORY_SCOPE");
    expect(productionWrangler).not.toContain("HISTORY_BUCKET");
    expect(productionWrangler).not.toContain("HISTORY_SCOPE");
    expect(preview).not.toContain("history_r2_bucket_name");
    expect(preview).not.toContain("pages_production_env_vars");
    expect(stable).toContain("history_r2_bucket_name");
    expect(stable).toContain("pages_production_env_vars");
    expect(deployScript).toContain('wrangler.staging-preview.toml');
    expect(deployScript).toContain('configPath: wranglerStagingPreview');
    expect(staging).toContain('history_r2_bucket_name');
    expect(stagingTerraformMain).toMatch(/pages_production_env_vars_plain\s*=\s*\{[\s\S]*HISTORY_SCOPE\s*=\s*"staging"[\s\S]*AUTH_SESSION_SOURCE\s*=\s*"transition"[\s\S]*\}/);
    const sharedStagingVars = staging.split("pages_env_vars_plain = {")[1]?.split("}\n")[0] ?? "";
    expect(sharedStagingVars).not.toContain("AUTH_SESSION_SOURCE");
    expect(production).not.toContain('history_r2_bucket_name');
    expect(previewWrangler).toBe(stagingWrangler
      .replace(/\n\[\[r2_buckets\]\]\nbinding = "HISTORY_BUCKET"\nbucket_name = "linksim-history-staging"\n/, "")
      .replace(/\n\[\[durable_objects\.bindings\]\]\nname = "AUTH"\nclass_name = "AuthRuntime"\nscript_name = "linksim-auth-runtime-staging"\n/, "")
      .replace('\nHISTORY_SCOPE = "staging"', "")
      .replace('\nAUTH_SESSION_SOURCE = "transition"', ""));
  });

  it("binds the private auth Durable Object only to stable staging", () => {
    expect(stagingWrangler).toContain('name = "AUTH"');
    expect(stagingWrangler).toContain('class_name = "AuthRuntime"');
    expect(stagingWrangler).toContain('script_name = "linksim-auth-runtime-staging"');
    expect(stagingWrangler).toContain('AUTH_SESSION_SOURCE = "transition"');
    expect(deployScript).toContain("parseDurableObjectBindings");
    expect(deployScript).toContain("unexpected Durable Object bindings");
    expect(previewWrangler).not.toContain('name = "AUTH"');
    expect(previewWrangler).not.toContain("AUTH_SESSION_SOURCE");
    expect(productionWrangler).not.toContain('name = "AUTH"');
    expect(productionWrangler).not.toContain("AUTH_SESSION_SOURCE");
  });

  it("keeps the staging Durable Object binding represented in Terraform", () => {
    expect(terraformVariables).toContain('variable "pages_production_durable_object_namespaces"');
    expect(moduleSource).toContain("var.pages_production_durable_object_namespaces");
    expect(stagingTerraformMain).toContain("pages_production_durable_object_namespaces");
    expect(read("infra/terraform/environments/staging/variables.tf")).toContain(
      "Stable staging requires exactly one AUTH Durable Object namespace ID.",
    );
    const namespaceVariable = read("infra/terraform/environments/staging/variables.tf")
      .split('variable "pages_production_durable_object_namespaces" {')[1]
      ?.split("\n}\n")[0] ?? "";
    expect(namespaceVariable).not.toContain("default");
    expect(productionTerraformMain).not.toContain("pages_production_durable_object_namespaces");
  });

  it("configures the staging auth pilot before deploying its runtime and Pages application", () => {
    const secretNames = [
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "AUTH_PILOT_GITHUB_ACCOUNT_ID",
      "AUTH_PILOT_LINKSIM_USER_ID",
    ];
    const runtime = deployWorkflow.indexOf("wrangler deploy --config workers/auth-runtime/wrangler.staging.toml");
    const pages = deployWorkflow.indexOf("npm run deploy:staging");
    expect(runtime).toBeGreaterThan(0);
    for (const secretName of secretNames) {
      const secret = deployWorkflow.indexOf(`secret put ${secretName}`);
      const sourceSecret = secretName === "TURNSTILE_SITE_KEY"
        ? "VITE_TURNSTILE_SITE_KEY"
        : secretName === "GITHUB_CLIENT_ID" || secretName === "GITHUB_CLIENT_SECRET"
          ? `BETTER_AUTH_${secretName}`
          : secretName;
      expect(deployWorkflow).toContain(`secrets.${sourceSecret}`);
      expect(secret).toBeGreaterThan(0);
      expect(secret).toBeLessThan(runtime);
    }
    expect(pages).toBeGreaterThan(runtime);
    expect(deployWorkflow).toContain('test "${#BETTER_AUTH_SECRET}" -ge 32');
    expect(deployWorkflow).toContain('VITE_BETTER_AUTH_PILOT: "true"');
    expect(deployWorkflow).toContain("VITE_TURNSTILE_SITE_KEY: ${{ secrets.VITE_TURNSTILE_SITE_KEY }}");
    expect(deployWorkflow).toContain("TURNSTILE_SITE_KEY: ${{ secrets.VITE_TURNSTILE_SITE_KEY }}");
    expect(productionTerraformMain).not.toContain("AUTH_PILOT_GITHUB_ACCOUNT_ID");
  });
});
