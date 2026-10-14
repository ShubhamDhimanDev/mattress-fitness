// Cart form actions that are ours, not Hydrogen's. Hydrogen's CartForm types only accept the built-in names or a
// name starting with "Custom". They travel in the same envelope as the built-in ones, so optimistic UI and the
// one `/cart` endpoint stay the same.

export const CHANGE_SIZE_ACTION = 'CustomChangeSize';
