import { lazy, type ComponentProps, type ComponentType } from 'react';

/** Renewers of the lazy components whose import failed since the last retry. */
const failed = new Set<() => void>();

/** Gives every lazy component whose import failed a fresh import for its next render; `ErrorBoundary` calls it on `Réessayer`. */
export function renewFailedLazies(): void {
  for (const renew of [...failed]) renew();
  failed.clear();
}

/**
 * `React.lazy` that can import again after a failure. A plain lazy component remembers its rejected import
 * forever, so `Réessayer` would show the same error. A failed import is kept (so React shows the error once,
 * with no retry loop) until `renewFailedLazies` swaps in a fresh lazy component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<C extends ComponentType<any>>(load: () => Promise<{ default: C }>): ComponentType<ComponentProps<C>> {
  const make = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        failed.add(() => {
          Current = make();
        });
        throw error;
      }),
    );
  let Current = make();
  return function LazyRetry(props: ComponentProps<C>) {
    return <Current {...(props as ComponentProps<typeof Current>)} />;
  };
}
