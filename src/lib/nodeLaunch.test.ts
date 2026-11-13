import { expect, it } from "vitest";
import { parse868NodeLaunch } from "./nodeLaunch";

it("recognizes only the root 868.no launch and normalizes the selected ID", () => {
  expect(parse868NodeLaunch({ pathname: "/", search: "?source=868-no&node=%2102EB8E7C" })).toBe("!02eb8e7c");
  expect(parse868NodeLaunch({ pathname: "/simulation/site", search: "?source=868-no&node=%2102eb8e7c" })).toBeUndefined();
  expect(parse868NodeLaunch({ pathname: "/", search: "?source=868-no&node=invalid" })).toBeNull();
  expect(parse868NodeLaunch({ pathname: "/", search: "?source=868-no&node=%2102eb8e7c&node=%2100000001" })).toBeNull();
});
