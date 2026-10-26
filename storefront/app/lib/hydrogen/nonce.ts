import {createContext, useContext} from 'react';

// The CSP nonce for the document's scripts, provided on the server by `createContentSecurityPolicy` and on the client by
// entry.client.tsx (read from an existing script tag). Hydrogen 2026.10 no longer ships it (ADR-0012).
const NonceContext = createContext<string | undefined>(undefined);

export const NonceProvider = NonceContext.Provider;

export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
