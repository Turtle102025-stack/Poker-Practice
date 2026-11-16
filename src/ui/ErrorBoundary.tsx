import { Component, type ErrorInfo, type ReactNode } from 'react';

/** If something breaks while drawing the page, show a calm message instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <h1>Something went wrong</h1>
        <p>
          The page hit an unexpected error. Your bankroll, hands and the table you're at are saved after every
          action, so reloading should bring you right back.
        </p>
        <div className="row wrap">
          <button className="act raise" onClick={() => window.location.reload()}>Reload</button>
          <a className="link" href="#/" onClick={() => setTimeout(() => window.location.reload(), 0)}>Go to the lobby</a>
        </div>
        <pre className="error small">{String(this.state.error?.stack ?? this.state.error)}</pre>
      </div>
    );
  }
}
