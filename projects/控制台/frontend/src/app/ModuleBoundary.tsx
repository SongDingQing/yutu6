import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

export function ModuleBoundary({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary name={name}>
      <Suspense fallback={<ModuleLoading name={name} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function ModuleLoading({ name }: { name: string }) {
  return (
    <section className="module-state" aria-label={`正在载入${name}`}>
      <span className="module-spinner" aria-hidden="true" />
      <strong>正在载入{name}</strong>
    </section>
  );
}
