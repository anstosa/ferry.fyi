import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component {
  state: {
    hasError: boolean;
  };

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  componentDidCatch(error: any, info: any): void {
    this.setState({ hasError: true });
    console.error(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <p className="p-2">(error)</p>;
    }
    return this.props.children;
  }
}
