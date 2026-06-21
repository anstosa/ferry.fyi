import * as Sentry from "@sentry/react";
import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  fallbackMessage?: string;
  fallbackTitle?: string;
  resetKey?: string | number | null;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  };

  // mark render failure
  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  // reset after context change
  componentDidUpdate(previousProps: Props): void {
    // reset boundary guard
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  // report render failure
  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error);
    console.error(error, info);
  }

  // retry child render
  retry = (): void => {
    this.setState({ hasError: false });
  };

  // render fallback
  render(): ReactNode {
    const {
      children,
      className = "m-4",
      fallbackMessage = "Something went wrong. You can keep using the rest of Ferry FYI.",
      fallbackTitle = "This section crashed",
    } = this.props;

    // fallback guard
    if (this.state.hasError) {
      return (
        <div
          className={[
            "alert alert--error rounded",
            "flex flex-col gap-3",
            className,
          ].join(" ")}
          role="alert"
        >
          <h2 className="font-bold text-lg">{fallbackTitle}</h2>
          <p>{fallbackMessage}</p>
          <button
            className="button button-primary self-start"
            onClick={this.retry}
          >
            Try again
          </button>
        </div>
      );
    }

    return children;
  }
}
