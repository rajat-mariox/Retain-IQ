"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side hooks for keeping rapid interaction from turning into a storm of
 * API calls. Four shapes, one per way the UI over-fires:
 *
 *   useDebouncedValue  — a value that settles after typing stops (search boxes)
 *   useDebouncedCallback — a function whose last call within a window wins (auto-save)
 *   useSubmitLock      — one in-flight action at a time (double-click submits)
 *   useCoalescedCallback — many bursty triggers collapsed into one (refresh spam)
 *
 * None of these throttle the server (that is rate limiting, done in the API);
 * they stop the client from asking more than it means to.
 */

/**
 * Returns `value` but only after it has stopped changing for `delayMs`. Drive
 * a search/filter request off the returned value instead of the raw input, so
 * the network is hit once the user pauses rather than on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

/**
 * Wraps `fn` so that rapid successive calls collapse to a single invocation
 * `delayMs` after the last one — the classic debounce, for live auto-save on a
 * slider/toggle/field. Always calls with the most recent arguments. The
 * returned `cancel` drops a pending call (e.g. on unmount or explicit save).
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs = 400,
): ((...args: A) => void) & { cancel: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest fn without re-creating the debounced wrapper each render.
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]); // clear any pending timer on unmount

  const debounced = useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current(...args);
      }, delayMs);
    },
    [delayMs],
  ) as ((...args: A) => void) & { cancel: () => void };

  debounced.cancel = cancel;
  return debounced;
}

/**
 * Guards an async action so a second call is ignored while the first is still
 * in flight — what a double-clicked "Approve"/"Submit"/"Check in" button needs.
 * `run` no-ops if already busy; `busy` drives the disabled/spinner state.
 *
 *   const { busy, run } = useSubmitLock();
 *   <button disabled={busy} onClick={() => run(() => post(url))}>Approve</button>
 */
export function useSubmitLock(): {
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  // A ref so two synchronous clicks in the same tick can't both pass the check
  // before React has re-rendered with busy=true.
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

/**
 * Collapses bursts of a zero-arg trigger (an SSE handler firing per event, a
 * loop calling router.refresh()) into at most one call per `windowMs`. Unlike
 * a debounce it runs on the LEADING edge — the first call fires immediately and
 * further calls inside the window are dropped — so a live view still updates at
 * once but cannot refresh dozens of times a second.
 */
export function useCoalescedCallback(
  fn: () => void,
  windowMs = 1000,
): () => void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);
  const lastRun = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (trailing.current) clearTimeout(trailing.current);
    };
  }, []);

  return useCallback(() => {
    const now = Date.now();
    const since = now - lastRun.current;
    if (since >= windowMs) {
      lastRun.current = now;
      latest.current();
    } else if (!trailing.current) {
      // Ensure the final state after a burst isn't lost: run once at window end.
      trailing.current = setTimeout(() => {
        trailing.current = null;
        lastRun.current = Date.now();
        latest.current();
      }, windowMs - since);
    }
  }, [windowMs]);
}
