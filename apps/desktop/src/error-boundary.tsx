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
      <div className="h-screen overflow-auto bg-background p-6 font-mono text-[12.5px] whitespace-pre-wrap text-destructive">
        <div className="mb-2 font-semibold">Renderer crashed: {error.message}</div>
        <button
          type="button"
          onClick={() => this.setState({ error: undefined })}
          className="mb-4 cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-foreground"
        >
          Try to recover
        </button>
        <div className="opacity-80">{error.stack}</div>
      </div>
    );
  }
}
