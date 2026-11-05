/** Waits before each new attempt of a request that failed for a transient reason. */
export const transientRetryDelaysMs = [1000, 3000] as const;

/** Server and gateway failures that may pass on their own, such as a moment without database connections. */
export const isTransientStatus = (status: number) => status === 500 || status === 502 || status === 503 || status === 504;

const abortError = () => new DOMException("The request was cancelled.", "AbortError");

/** A wait that ends early, with an AbortError, when the request is cancelled. */
function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs a read request and tries it again after each delay while it fails for a transient reason (a transient
 * status or a network failure). The last response is returned, so the caller shows its message; client errors
 * return at once, and a cancelled request stops without another attempt. Only for requests that change nothing.
 */
export async function fetchRetryingTransient(request: () => Promise<Response>, signal: AbortSignal,
  delays: readonly number[] = transientRetryDelaysMs,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = abortableWait): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await request();
    } catch (error) {
      if (signal.aborted || attempt >= delays.length) throw signal.aborted ? abortError() : error;
    }
    if (signal.aborted) throw abortError();
    if (response && (!isTransientStatus(response.status) || attempt >= delays.length)) return response;
    await wait(delays[attempt], signal);
  }
}
