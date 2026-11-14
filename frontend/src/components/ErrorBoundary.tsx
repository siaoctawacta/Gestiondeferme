import { Component, type ErrorInfo, type ReactNode } from 'react';
import { renewFailedLazies } from './lazyRetry';
import { ErrorRetry } from './module/ErrorRetry';

export const RENDER_ERROR_MESSAGE = 'Une erreur est survenue lors du chargement.';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Replaces the default error card; call `reset` to retry. */
  fallback?: (reset: () => void) => ReactNode;
  /** When this value changes (e.g. the pathname) a shown error is cleared and the children render again. */
  resetKey?: unknown;
}

/**
 * Catches render errors and failed lazy chunks below it and shows the standard error card with `Réessayer`.
 * Retrying re-renders the children from scratch (a lazy component made with `lazyRetry` imports again).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => {
    renewFailedLazies();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.reset) : <ErrorRetry message={RENDER_ERROR_MESSAGE} onRetry={this.reset} />;
  }
}
