/** A job refused because its request was cancelled before it could start. */
export class WorkCancelledError extends Error {
  constructor() {
    super("A requisição foi cancelada antes de ser processada.");
    this.name = "WorkCancelledError";
  }
}

export type WorkGate = {
  /** Runs the job when a place is free; a cancelled signal drops it from the queue without running it. */
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly active: number;
  readonly waiting: number;
};

type Waiting = { start: () => void; cancel: () => void; signal?: AbortSignal };

/**
 * Bounds how many heavy jobs run at once, so they never hold every database connection: the others wait in
 * arrival order in this queue, which has no time limit, instead of in the pool queue, which fails after a few
 * seconds and takes the light requests (such as the session check) down with them.
 */
export function createWorkGate(limit: number): WorkGate {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("O limite de trabalhos simultâneos deve ser um inteiro positivo.");
  let active = 0;
  const queue: Waiting[] = [];

  const next = () => {
    while (active < limit && queue.length) {
      const waiting = queue.shift()!;
      if (waiting.signal?.aborted) waiting.cancel();
      else waiting.start();
    }
  };

  return {
    get active() { return active; },
    get waiting() { return queue.length; },
    run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(new WorkCancelledError());
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(waiting);
          if (index !== -1) { queue.splice(index, 1); reject(new WorkCancelledError()); }
        };
        const waiting: Waiting = {
          signal,
          cancel: () => { signal?.removeEventListener("abort", onAbort); reject(new WorkCancelledError()); },
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            active++;
            // The place is freed before the caller hears back; a job that throws before returning its promise frees it too.
            const finish = () => { active--; next(); };
            new Promise<T>(settle => settle(work())).then(value => { finish(); resolve(value); },
              (error: unknown) => { finish(); reject(error); });
          },
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(waiting);
        next();
      });
    },
  };
}
