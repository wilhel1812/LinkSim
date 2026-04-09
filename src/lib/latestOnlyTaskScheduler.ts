export type LatestOnlyTaskContext = {
  isCancelled: () => boolean;
};

export type LatestOnlyTask = {
  signature: string;
  run: (context: LatestOnlyTaskContext) => Promise<void> | void;
};

export type LatestOnlyTaskEnqueueResult = "started" | "queued" | "deduped-active" | "deduped-queued";

export type LatestOnlyTaskSchedulerSnapshot = {
  running: boolean;
  activeSignature: string | null;
  queuedSignature: string | null;
};

export type LatestOnlyTaskScheduler = {
  enqueue: (task: LatestOnlyTask) => LatestOnlyTaskEnqueueResult;
  cancelActive: () => void;
  clearQueue: () => void;
  dispose: () => void;
  snapshot: () => LatestOnlyTaskSchedulerSnapshot;
};

export const createLatestOnlyTaskScheduler = (): LatestOnlyTaskScheduler => {
  let activeTask: { task: LatestOnlyTask; cancelled: boolean } | null = null;
  let queuedTask: LatestOnlyTask | null = null;
  let disposed = false;

  const snapshot = (): LatestOnlyTaskSchedulerSnapshot => ({
    running: activeTask !== null,
    activeSignature: activeTask?.task.signature ?? null,
    queuedSignature: queuedTask?.signature ?? null,
  });

  const launchIfIdle = (): void => {
    if (disposed || activeTask || !queuedTask) return;
    const current = queuedTask;
    queuedTask = null;
    activeTask = { task: current, cancelled: false };

    void Promise.resolve()
      .then(() =>
        current.run({
          isCancelled: () => activeTask?.task === current && activeTask.cancelled,
        }),
      )
      .finally(() => {
        if (activeTask?.task === current) {
          activeTask = null;
        }
        launchIfIdle();
      });
  };

  const enqueue = (task: LatestOnlyTask): LatestOnlyTaskEnqueueResult => {
    if (disposed) return "deduped-active";
    if (!activeTask) {
      queuedTask = task;
      launchIfIdle();
      return "started";
    }
    if (activeTask.task.signature === task.signature) {
      return "deduped-active";
    }
    if (queuedTask?.signature === task.signature) {
      return "deduped-queued";
    }
    queuedTask = task;
    return "queued";
  };

  const cancelActive = (): void => {
    if (!activeTask) return;
    activeTask.cancelled = true;
  };

  const clearQueue = (): void => {
    queuedTask = null;
  };

  const dispose = (): void => {
    disposed = true;
    queuedTask = null;
    cancelActive();
  };

  return {
    enqueue,
    cancelActive,
    clearQueue,
    dispose,
    snapshot,
  };
};
