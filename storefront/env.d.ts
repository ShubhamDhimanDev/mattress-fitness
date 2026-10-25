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
    /** The client's support phone (a US number, any common format); no phone link shows until it is set (REQ-CNT-001). */
    PUBLIC_SUPPORT_PHONE?: string;
    /**
     * Opt-in handle of the Shopify navigation menu that drives the header (REQ-NAV-002), for example `main-menu`.
     * Unset, blank, `none` or invalid keeps the fixed navigation and makes no menu request.
     */
    PUBLIC_NAV_MENU_HANDLE?: string;
    /** `opt-in` (default, stricter) or `opt-out`: whether analytics waits for the shopper's agreement (P7-01, NFR-011). */
    PUBLIC_CONSENT_MODE?: string;
    /** Google Analytics 4 measurement id (`G-XXXXXXXX`). Unset: nothing loads, no CSP host is added (REQ-ANL-001). */
    PUBLIC_GA4_MEASUREMENT_ID?: string;
    /** Meta pixel id (digits). Unset: nothing loads, no CSP host is added (REQ-ANL-002). */
    PUBLIC_META_PIXEL_ID?: string;
    /** Klaviyo private key for the signup form (server only, P7-02). Unset: no signup form is rendered. */
    KLAVIYO_PRIVATE_API_KEY?: string;
    /** Klaviyo list id that signups join (server only, P7-02). Unset: no signup form is rendered. */
    KLAVIYO_LIST_ID?: string;
    /** The exact text `true` offers the optional text-message fields (P7-02); anything else is off. */
    PUBLIC_KLAVIYO_SMS_ENABLED?: string;
  }
}
