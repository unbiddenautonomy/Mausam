import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANG, setDateLang, translate, type Lang, type MessageKey, type User } from "@mausam/shared";
import { api, clearCopies, flushQueue, getToken, setQueueOwner, setToken, setUnauthorisedHandler } from "./api";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

interface Session {
  user: User | null;
  ready: boolean;
  lang: Lang;
  t: T;
  setLang: (l: Lang) => void;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);
const LANG_KEY = "mausam.lang";

function storedLang(): Lang {
  try {
    const l = localStorage.getItem(LANG_KEY);
    if (l === "en" || l === "hi" || l === "kn") {
      setDateLang(l);
      return l;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>(storedLang);

  const applyLang = useCallback((l: Lang) => {
    setLangState(l);
    setDateLang(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setUnauthorisedHandler(() => setUser(null));
    if (!getToken()) {
      setReady(true);
      return;
    }
    api<{ user: User }>("/auth/me")
      .then((r) => {
        setUser(r.user);
        applyLang(r.user.language);
      })
      .catch(() => {
        /* offline or logged out: show login if token was cleared */
      })
      .finally(() => setReady(true));
  }, [applyLang]);

  // Entries saved offline belong to whoever saved them; send them once that person is logged in.
  useEffect(() => {
    setQueueOwner(user?.id ?? null);
    if (user) void flushQueue();
  }, [user]);

  const value = useMemo<Session>(
    () => ({
      user,
      ready,
      lang,
      t: (key, params) => translate(lang, key, params),
      setLang: (l) => {
        applyLang(l);
        if (user) void api("/auth/me", { method: "PATCH", json: { language: l } }).catch(() => {});
      },
      signIn: (token, u) => {
        setToken(token);
        setUser(u);
        applyLang(u.language);
      },
      signOut: () => {
        void api("/auth/logout", { method: "POST" }).catch(() => {});
        clearCopies();
        setToken(null);
        setUser(null);
      },
    }),
    [user, ready, lang, applyLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside provider");
  return s;
}

export const useT = () => useSession().t;
