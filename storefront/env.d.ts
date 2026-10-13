/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  interface Env {
    /** Public origin of the storefront for canonical links and structured data (P-L2); see lib/site-origin.ts. */
    PUBLIC_SITE_URL?: string;
  }
}
