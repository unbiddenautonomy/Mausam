import { useCallback, useEffect, useRef, useState } from "react";
import { businessDate } from "@mausam/shared";
import { api, ApiError, savedCopy, saveCopy } from "./api";

/** Load JSON from the API. `reload()` fetches again. Without internet it shows the last good reply, with `savedAt` set. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
        setSavedAt(null);
        saveCopy(path, d);
      })
      .catch((e) => {
        if (n !== seq.current) return;
        const copy = e instanceof ApiError ? null : savedCopy<T>(path);
        if (copy) {
          setData(copy.data);
          setError(null);
          setSavedAt(copy.at);
        } else setError(e);
      })
      .finally(() => n === seq.current && setLoading(false));
  }, [path]);

  useEffect(load, [load]);
  useSavedCopyNote(savedAt);
  return { data, error, loading, savedAt, reload: load };
}

/* Pages showing a saved copy, so the layout can say so once at the top. */
const showingCopies = new Map<symbol, number>();
const copyListeners = new Set<(oldest: number | null) => void>();
const oldestCopy = () => (showingCopies.size ? Math.min(...showingCopies.values()) : null);

function useSavedCopyNote(savedAt: number | null) {
  const id = useRef(Symbol("page"));
  useEffect(() => {
    if (savedAt === null) return;
    const key = id.current;
    showingCopies.set(key, savedAt);
    copyListeners.forEach((l) => l(oldestCopy()));
    return () => {
      showingCopies.delete(key);
      copyListeners.forEach((l) => l(oldestCopy()));
    };
  }, [savedAt]);
}

/** When the oldest saved copy on screen was saved, or null when everything shown is fresh. */
export function useShowingSavedCopy(): number | null {
  const [oldest, setOldest] = useState(oldestCopy);
  useEffect(() => {
    copyListeners.add(setOldest);
    return () => void copyListeners.delete(setOldest);
  }, []);
  return oldest;
}

/**
 * Calls `reload` when the page comes back into view after a while, and when the business day rolls over (5 am), so
 * a screen left open overnight doesn't show yesterday.
 */
export function useRefreshOnReturn(reload: () => void, shownDate: string | undefined) {
  const hiddenAt = useRef<number | null>(null);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null && Date.now() - hiddenAt.current > 30_000) latest.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!shownDate) return;
    const id = window.setInterval(() => {
      if (!document.hidden && businessDate() !== shownDate) latest.current();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [shownDate]);
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Keeps a form draft on the phone so a closed tab or dead battery doesn't lose it. */
export function useDraft<T extends object>(key: string, initial: T) {
  const storageKey = `mausam.draft.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [storageKey, value]);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  return [value, setValue, clear] as const;
}

export function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setMatch(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [q]);
  return match;
}
