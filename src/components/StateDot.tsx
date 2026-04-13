import clsx from "clsx";

type StateDotProps = {
  state: "pass_clear" | "pass_blocked" | "fail_clear" | "fail_blocked";
  className?: string;
};

export function StateDot({ state, className }: StateDotProps) {
  return <span className={clsx("state-dot", `state-dot-${state}`, className)} />;
}