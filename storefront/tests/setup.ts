// Shared Vitest setup. Keep it tiny: tests must not depend on hidden global state.
if (typeof document !== 'undefined') {
  // Only jsdom tests get the DOM matchers (toBeInTheDocument, toHaveAccessibleName, ...).
  await import('@testing-library/jest-dom/vitest');
  // Testing Library's waitFor/findBy default to 1 s, too tight when many jsdom files run in parallel (same reason as the
  // Vitest testTimeout).
  const {configure} = await import('@testing-library/react');
  configure({asyncUtilTimeout: 5000});
}

export {};
