import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("self-hosted proxy configuration", () => {
  const nginx = readRepoFile("nginx/default.conf");

  it("allows only the exact passive MeshMap resource contract", () => {
    expect(nginx).toContain("location = /meshmap/nodes.json {");
    expect(nginx).toMatch(/if \(\$args != ""\) \{\s+return 400;/);
    expect(nginx).toMatch(/if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{\s+return 405;/);
    expect(nginx).toContain("location = /meshmap {");
    expect(nginx).toContain("location ^~ /meshmap/ {");
    expect(nginx.match(/return 404 "Not found\\n";/g)).toHaveLength(2);
    expect(nginx.match(/add_header Cache-Control no-store always;/g)).toHaveLength(2);
  });

  it("does not relay caller credentials or forwarding identity", () => {
    expect(nginx).toContain("proxy_pass_request_headers off;");
    expect(nginx).toContain("proxy_pass_request_body off;");
    expect(nginx).toContain("proxy_set_header Host meshmap.net;");
    expect(nginx).toContain("proxy_set_header Accept application/json;");
    for (const header of [
      "Authorization",
      "Cookie",
      "Set-Cookie",
      "CF-Access-Authenticated-User-Email",
      "CF-Access-Authenticated-User-Id",
      "CF-Access-Authenticated-User-Name",
      "CF-Access-Jwt-Assertion",
      "CF-Connecting-IP",
      "X-Forwarded-For",
      "X-Real-IP",
    ]) {
      expect(nginx).toContain(`proxy_hide_header ${header};`);
    }
  });

  it("does not relay origin-active upstream response headers", () => {
    expect(nginx).toContain(
      "proxy_ignore_headers X-Accel-Redirect X-Accel-Expires X-Accel-Limit-Rate X-Accel-Buffering X-Accel-Charset;",
    );
    for (const header of [
      "Clear-Site-Data",
      "Refresh",
      "Location",
      "Content-Location",
      "Alt-Svc",
      "Content-Security-Policy",
      "Content-Security-Policy-Report-Only",
      "Permissions-Policy",
      "Origin-Trial",
      "Accept-CH",
      "Critical-CH",
      "Report-To",
      "Reporting-Endpoints",
      "NEL",
      "Link",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Credentials",
      "Access-Control-Expose-Headers",
      "Strict-Transport-Security",
    ]) {
      expect(nginx).toContain(`proxy_hide_header ${header};`);
    }
  });

  it("forces passive response handling and direct-peer rate limiting", () => {
    expect(nginx).toContain("limit_req_zone $binary_remote_addr zone=meshmap_per_ip:10m rate=120r/m;");
    expect(nginx).toContain("limit_req_status 429;");
    expect(nginx).toContain('add_header Content-Type "application/json; charset=utf-8" always;');
    expect(nginx).toContain('add_header Content-Disposition "attachment; filename=nodes.json" always;');
    expect(nginx).toContain("add_header X-Content-Type-Options nosniff always;");
    expect(nginx).toMatch(/~\^2\s+"public, max-age=1800";/);
    expect(nginx).toMatch(/default\s+"no-store";/);
  });

  it("binds only Docker development and edge ports to loopback by default", () => {
    const compose = readRepoFile("docker-compose.yml");
    expect(compose).toContain('${LINKSIM_DOCKER_BIND_ADDRESS:-127.0.0.1}:5173:5173');
    expect(compose).toContain('${LINKSIM_DOCKER_BIND_ADDRESS:-127.0.0.1}:8788:8788');
    expect(compose).toContain('- "8080:80"');
    expect(compose).toContain('- "8000:8000"');
  });
});
