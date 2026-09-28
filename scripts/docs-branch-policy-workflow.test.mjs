import { readFileSync } from "node:fs";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
  "../.github/workflows/docs-branch-policy.yml",
  import.meta.url,
);
const source = readFileSync(workflowUrl, "utf8");
const workflow = yaml.load(source);
const evaluator = workflow.jobs["evaluate-main-docs"];
const publisher = workflow.jobs["publish-main-docs"];

describe("documentation branch policy workflow", () => {
  it("keeps the protected-base evaluator as the publisher's sole decision", () => {
    expect(workflow.on.pull_request_target.branches).toEqual(["main"]);

    const checkoutStep = evaluator.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkoutStep.with.ref).toBe(
      "${{ github.event.pull_request.base.sha }}",
    );
    expect(checkoutStep.with["persist-credentials"]).toBe(false);
    expect(JSON.stringify(evaluator)).toContain("--mode three-dot");

    expect(publisher.needs).toBe("evaluate-main-docs");
    expect(publisher.if).toBe("always()");
    expect(publisher.permissions).toEqual({});
    expect(publisher.environment).toBe("docs-policy-publisher");

    expect(JSON.stringify(evaluator)).toContain(
      "scripts/docs-only-policy.mjs require",
    );
    expect(JSON.stringify(publisher)).not.toContain("docs-only-policy");
  });

  it("mints a repository-scoped checks-only App token from the named environment values", () => {
    const tokenStep = publisher.steps.find(
      (step) => step.id === "docs-policy-app-token",
    );

    expect(tokenStep.uses).toBe(
      "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
    );
    expect(tokenStep.with).toEqual({
      "client-id": "${{ vars.DOCS_POLICY_APP_CLIENT_ID }}",
      "private-key": "${{ secrets.DOCS_POLICY_APP_PRIVATE_KEY }}",
      owner: "${{ github.repository_owner }}",
      repositories: "${{ github.event.repository.name }}",
      "permission-checks": "write",
    });
  });

  it("publishes the App-authored result on the validated exact pull-request head", () => {
    const publishStep = publisher.steps.find(
      (step) => step.name === "Publish documentation branch policy check",
    );

    expect(publishStep.uses).toBe(
      "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    );
    expect(publishStep.with["github-token"]).toBe(
      "${{ steps.docs-policy-app-token.outputs.token }}",
    );
    expect(publishStep.env).toEqual({
      EVALUATOR_RESULT: "${{ needs.evaluate-main-docs.result }}",
      HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
    });

    const script = publishStep.with.script;
    expect(script).toContain("/^[0-9a-f]{40}$/");
    expect(script).toContain("process.env.HEAD_SHA");
    expect(script).toContain('name: "Docs Branch Policy / enforce-main-docs"');
    expect(script).toContain("head_sha: headSha");
    expect(script).toContain('status: "completed"');
    expect(script).toContain(
      'evaluatorResult === "success" ? "success" : "failure"',
    );
    expect(script).not.toMatch(/neutral|cancelled|skipped/);
  });

  it("never checks out or executes pull-request content in the privileged publisher", () => {
    expect(publisher.steps.every((step) => !("run" in step))).toBe(true);
    expect(
      publisher.steps.some((step) => step.uses?.startsWith("actions/checkout@")),
    ).toBe(false);
    expect(publisher.steps.map((step) => step.uses)).toEqual([
      "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
      "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    ]);
  });
});
