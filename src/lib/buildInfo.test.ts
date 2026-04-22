import { describe, expect, it } from "vitest";
import { APP_BUILD_LABEL, APP_COMMIT, APP_VERSION, buildLabelForChannel } from "./buildInfo";

describe("buildInfo", () => {
  it("keeps the stable label on the base version", () => {
    expect(buildLabelForChannel("stable")).toBe(`v${APP_VERSION}`);
  });

  it("keeps preview labels on the same base version and commit", () => {
    expect(buildLabelForChannel("beta")).toBe(`v${APP_VERSION}-beta+${APP_COMMIT}`);
    expect(buildLabelForChannel("alpha")).toBe(`v${APP_VERSION}-alpha+${APP_COMMIT}`);
    expect(APP_BUILD_LABEL).toBe(`v${APP_VERSION}+${APP_COMMIT}`);
  });
});
