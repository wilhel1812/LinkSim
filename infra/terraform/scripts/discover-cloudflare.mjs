#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "85c57e0c4da3a747a09212dc5b090f52";
const zoneName = process.env.CLOUDFLARE_ZONE_NAME || "linksim.link";
const token = process.env.CLOUDFLARE_API_TOKEN;
const envName = process.argv[2] || "staging";
const writePath = process.argv[3] || "";

if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN before running discovery.");
  process.exit(1);
}

const cf = async (path) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.map((e) => `${e.code}: ${e.message}`).join(", ") || `HTTP ${res.status}`;
    throw new Error(`${path} -> ${msg}`);
  }
  return body.result;
};

const out = {
  account_id: accountId,
  zone_name: zoneName,
  zone_id: null,
  dns_records: [],
  pages_projects: [],
  d1_databases: [],
  r2_buckets: [],
  access_apps: [],
};

try {
  const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  out.zone_id = zones?.[0]?.id ?? null;
} catch (error) {
  out.zone_lookup_error = String(error);
}

try {
  if (out.zone_id) {
    const dns = await cf(`/zones/${out.zone_id}/dns_records?per_page=500`);
    out.dns_records = dns.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
    }));
  }
} catch (error) {
  out.dns_lookup_error = String(error);
}

try {
  const pages = await cf(`/accounts/${accountId}/pages/projects`);
  const projects = pages.projects || pages;
  out.pages_projects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    production_branch: p.production_branch,
    domains: p.domains,
  }));
} catch (error) {
  out.pages_lookup_error = String(error);
}

try {
  const d1 = await cf(`/accounts/${accountId}/d1/database`);
  out.d1_databases = d1.map((db) => ({ id: db.uuid || db.id, name: db.name }));
} catch (error) {
  out.d1_lookup_error = String(error);
}

try {
  const r2 = await cf(`/accounts/${accountId}/r2/buckets`);
  const buckets = r2.buckets || r2;
  out.r2_buckets = buckets.map((b) => ({ name: b.name }));
} catch (error) {
  out.r2_lookup_error = String(error);
}

try {
  const apps = await cf(`/accounts/${accountId}/access/apps`);
  const matching = apps.filter((app) => {
    const words = [app.name || "", app.domain || "", ...(app.self_hosted_domains || [])].join(" ").toLowerCase();
    return words.includes("linksim");
  });
  out.access_apps = [];
  for (const app of matching) {
    let policies = [];
    try {
      const result = await cf(`/accounts/${accountId}/access/apps/${app.id}/policies`);
      policies = result.map((p) => ({ id: p.id, name: p.name, decision: p.decision, precedence: p.precedence }));
    } catch (error) {
      policies = [{ error: String(error) }];
    }
    out.access_apps.push({
      id: app.id,
      name: app.name,
      domain: app.domain,
      self_hosted_domains: app.self_hosted_domains || [],
      policies,
    });
  }
} catch (error) {
  out.access_lookup_error = String(error);
}

const text = JSON.stringify(out, null, 2);
console.log(text);

if (writePath) {
  await writeFile(writePath, `${text}\n`, "utf8");
  console.error(`Wrote discovery output for ${envName} to ${writePath}`);
}
