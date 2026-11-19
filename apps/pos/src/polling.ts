import { useEffect, useRef } from "react";

/** While someone is using a screen (or orders are changing), check for the other screens' orders this often. */
export const BUSY_EVERY_MS = 4_000;
/** An idle screen checks this often: about 145 checks an hour. */
export const IDLE_EVERY_MS = 25_000;
/** A screen counts as busy for this long after the last tap or order change. */
export const BUSY_FOR_MS = 2 * 60_000;

/** How long to wait before the next check for orders. */
export function ordersDelay(lastActive: number, now: number): number {
  return now - lastActive < BUSY_FOR_MS ? BUSY_EVERY_MS : IDLE_EVERY_MS;
}

/**
 * Runs `fn` over and over, waiting `delay()` between runs. Nothing runs while the page is hidden; when it shows
 * again, `fn` runs at once. The returned function re-plans the next run, for when `delay()` has just got shorter.
 */
export function usePolling(fn: () => Promise<unknown> | void, delay: () => number): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const delayRef = useRef(delay);
  delayRef.current = delay;
  const replan = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    let dueAt = 0;
    const schedule = (wait = delayRef.current()) => {
      window.clearTimeout(timer);
      if (stopped || document.hidden) return;
      dueAt = Date.now() + wait;
      timer = window.setTimeout(run, wait);
    };
    const run = async () => {
      try {
        await fnRef.current();
      } catch {
        // the caller handles its own errors; keep polling
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else void run();
    };
    replan.current = () => {
      // Only ever brings the next run closer.
      const wait = delayRef.current();
      if (Date.now() + wait < dueAt) schedule(wait);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return () => replan.current();
}
