import { Component, type ReactNode } from "react";
import { DEFAULT_LANG, translate, type Lang } from "@mausam/shared";

function lang(): Lang {
  try {
    const l = localStorage.getItem("mausam.lang");
    if (l === "en" || l === "hi" || l === "kn") return l;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

/** Shows a calm "reload" screen instead of a blank page if a screen crashes. Offline entries stay queued. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("screen_crashed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const l = lang();
    return (
      <div className="center-screen">
        <div className="auth-card" role="alert">
          <h1>{translate(l, "crash.title")}</h1>
          <p className="muted">{translate(l, "crash.body")}</p>
          <button className="btn primary block" onClick={() => location.assign("/")}>{translate(l, "crash.reload")}</button>
        </div>
      </div>
    );
  }
}
