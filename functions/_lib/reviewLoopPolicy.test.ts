import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(
  process.cwd(),
  ".agents/skills/linksim-ci-shepherd/scripts/review-loop-policy",
);
const head = "a".repeat(40);

type Decision = {
  decision: string;
  remaining_findings: { p0: number; p1: number; p2: number; p3: number };
};

function decide(...args: string[]): Decision {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        script,
        "--mode",
        "all-findings",
        "--budget",
        "8",
        "--reviews-used",
        "1",
        "--reviewed-head",
        head,
        "--current-head",
        head,
        ...args,
      ],
      { encoding: "utf8" },
    ),
  ) as Decision;
}

describe("native review loop policy", () => {
  it("defaults to an eight-request budget", () => {
    const result = JSON.parse(
      execFileSync(
        "python3",
        [
          script,
          "--mode",
          "all-findings",
          "--reviews-used",
          "1",
          "--reviewed-head",
          head,
          "--current-head",
          head,
        ],
        { encoding: "utf8" },
      ),
    ) as { budget: number };
    expect(result.budget).toBe(8);
  });

  it("completes only a clean all-findings review", () => {
    expect(decide("--p1", "0", "--p2", "0", "--p3", "0").decision).toBe(
      "complete-clean",
    );
    expect(decide("--p1", "0", "--p2", "1", "--p3", "0").decision).toBe(
      "fix-and-review",
    );
  });

  it("lets no-p1 stop while reporting lower-priority findings", () => {
    const result = decide(
      "--mode",
      "no-p1",
      "--p1",
      "0",
      "--p2",
      "2",
      "--p3",
      "1",
    );
    expect(result.decision).toBe("complete-threshold");
    expect(result.remaining_findings).toEqual({ p0: 0, p1: 0, p2: 2, p3: 1 });
  });

  it("continues no-p1 while an actionable P0 or P1 remains", () => {
    expect(
      decide("--mode", "no-p1", "--p1", "1", "--p2", "3", "--p3", "0")
        .decision,
    ).toBe("fix-and-review");
    expect(
      decide("--mode", "no-p1", "--p0", "1", "--p1", "0", "--p2", "0")
        .decision,
    ).toBe("fix-and-review");
  });

  it("stops before requesting a review beyond the budget", () => {
    expect(
      decide(
        "--reviews-used",
        "8",
        "--p1",
        "1",
        "--p2",
        "0",
        "--p3",
        "0",
      ).decision,
    ).toBe("stop-budget");
  });

  it("rejects a review for a stale head", () => {
    expect(
      decide(
        "--reviewed-head",
        "b".repeat(40),
        "--p1",
        "0",
        "--p2",
        "0",
        "--p3",
        "0",
      ).decision,
    ).toBe("stop-stale-review");
  });

  it("stops on an explicit external or authority blocker", () => {
    expect(
      decide(
        "--blocking-condition",
        "external-failure",
        "--p1",
        "1",
        "--p2",
        "0",
        "--p3",
        "0",
      ).decision,
    ).toBe("stop-blocked");
  });

  it("requires architectural reassessment after repeated targeted findings", () => {
    expect(
      decide(
        "--p2-streak",
        "1",
        "--p1",
        "0",
        "--p2",
        "1",
        "--p3",
        "0",
      ).decision,
    ).toBe("fix-and-review");
    expect(
      decide(
        "--p2-streak",
        "2",
        "--p1",
        "0",
        "--p2",
        "1",
        "--p3",
        "0",
      ).decision,
    ).toBe("reassess-architecture");
  });

  it("checks an exhausted budget before architectural reassessment", () => {
    expect(
      decide(
        "--reviews-used",
        "8",
        "--p1",
        "1",
        "--p1-streak",
        "2",
      ).decision,
    ).toBe("stop-budget");
  });

  it("ignores retained lower-priority streaks in no-p1 mode", () => {
    expect(
      decide(
        "--mode",
        "no-p1",
        "--p1",
        "1",
        "--p1-streak",
        "1",
        "--p2",
        "1",
        "--p2-streak",
        "2",
      ).decision,
    ).toBe("fix-and-review");
  });
});
