import { describe, expect, it } from "vitest";
import { createLatestOnlyTaskScheduler, type LatestOnlyTask } from "./latestOnlyTaskScheduler";

const flushMicrotasks = async (count = 8): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

const task = (
  signature: string,
  run: LatestOnlyTask["run"],
): LatestOnlyTask => ({
  signature,
  run,
});

describe("createLatestOnlyTaskScheduler", () => {
  it("runs latest queued task after active task completes", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = createLatestOnlyTaskScheduler();

    const firstTask = task("first", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:done");
    });
    const secondTask = task("second", async () => {
      order.push("second:done");
    });
    const thirdTask = task("third", async () => {
      order.push("third:done");
    });

    expect(scheduler.enqueue(firstTask)).toBe("started");
    expect(scheduler.enqueue(secondTask)).toBe("queued");
    expect(scheduler.enqueue(thirdTask)).toBe("queued");

    releaseFirst();
    await flushMicrotasks();

    expect(order).toEqual(["first:start", "first:done", "third:done"]);
    expect(scheduler.snapshot()).toEqual({
      running: false,
      activeSignature: null,
      queuedSignature: null,
    });
  });

  it("deduplicates matching active and queued signatures", async () => {
    const scheduler = createLatestOnlyTaskScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    expect(
      scheduler.enqueue(
        task("a", async () => {
          await gate;
        }),
      ),
    ).toBe("started");
    expect(scheduler.enqueue(task("a", async () => {}))).toBe("deduped-active");
    expect(scheduler.enqueue(task("b", async () => {}))).toBe("queued");
    expect(scheduler.enqueue(task("b", async () => {}))).toBe("deduped-queued");

    release();
    await flushMicrotasks();
  });

  it("marks active task cancelled and still runs queued latest task", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = createLatestOnlyTaskScheduler();

    expect(
      scheduler.enqueue(
        task("a", async (context) => {
          order.push("a:start");
          await gate;
          if (context.isCancelled()) {
            order.push("a:cancelled");
            return;
          }
          order.push("a:done");
        }),
      ),
    ).toBe("started");
    expect(
      scheduler.enqueue(
        task("b", async () => {
          order.push("b:done");
        }),
      ),
    ).toBe("queued");

    scheduler.cancelActive();
    release();
    await flushMicrotasks();

    expect(order).toEqual(["a:start", "a:cancelled", "b:done"]);
  });
});
