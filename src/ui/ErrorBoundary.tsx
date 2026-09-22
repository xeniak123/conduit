import { Component, type ErrorInfo, type ReactNode } from "react";
import { Logo } from "./Logo";

interface State {
  error: Error | null;
  info: string;
}

/**
 * The last line of defence against a blank window.
 *
 * A thrown render in a frameless window produces an empty rectangle floating
 * on the desktop — no message, no menu, nothing to click. That reads as "this
 * application is broken" when the cause is usually one component and one bad
 * value. Catching it gives the user something to read, something to copy, and
 * a way back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[conduit] render failed", error, info);
    this.setState({ info: info.componentStack ?? "" });
  }

  private copy = (): void => {
    const { error, info } = this.state;
    const report = [
      `Conduit ${__APP_VERSION__}`,
      navigator.userAgent,
      "",
      error?.stack ?? String(error),
      "",
      info,
    ].join("\n");
    void navigator.clipboard.writeText(report).catch(() => undefined);
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__card">
          <span className="crash__mark">
            <Logo size={24} />
          </span>
          <h1 className="crash__title">Something broke on screen</h1>
          <p className="crash__body">
            Conduit is still running in the tray. Your conversations and settings are
            untouched. Reloading the window usually fixes it.
          </p>
          <pre className="crash__detail">{error.message}</pre>
          <div className="crash__actions">
            <button className="btn" onPointerDown={this.copy}>
              Copy details
            </button>
            <button className="btn btn--accent" onPointerDown={() => window.location.reload()}>
              Reload the window
            </button>
          </div>
        </div>
      </div>
    );
  }
}
