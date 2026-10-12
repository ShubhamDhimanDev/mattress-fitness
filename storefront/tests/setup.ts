// Shared Vitest setup. Keep it tiny: tests must not depend on hidden global state.
if (typeof document !== 'undefined') {
  // Only jsdom tests get the DOM matchers (toBeInTheDocument, toHaveAccessibleName, ...).
  await import('@testing-library/jest-dom/vitest');
}

export {};
