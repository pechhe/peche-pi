import React from "react";

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * Last-resort guard so a render throw shows the error instead of a blank
 * window (the renderer has no other recovery surface). Logs to the console so
 * the stack is visible in DevTools / dev terminal.
 */
export class ErrorBoundary extends React.Component<{ readonly children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[renderer] uncaught render error:", error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div
        style={{
          padding: "24px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12.5px",
          color: "#e06c6c",
          whiteSpace: "pre-wrap",
          overflow: "auto",
          height: "100vh",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Renderer crashed: {error.message}</div>
        <button
          type="button"
          onClick={() => this.setState({ error: undefined })}
          style={{ marginBottom: 16, padding: "4px 12px", cursor: "pointer" }}
        >
          Try to recover
        </button>
        <div style={{ opacity: 0.8 }}>{error.stack}</div>
      </div>
    );
  }
}
