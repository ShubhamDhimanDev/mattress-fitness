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
    /**
     * Live-chat provider id (P7-03, REQ-ANL-004). Unset (the default): no chat, no code, no request, no "Chat with us".
     * Only `fake` is runnable, and only in development; Shopify Inbox is blocked (docs/integrations/CHAT.md).
     */
    PUBLIC_CHAT_PROVIDER?: string;
    /** The exact text `false` lets chat load without the shopper's analytics consent; anything else keeps consent required. */
    PUBLIC_CHAT_REQUIRES_CONSENT?: string;
    /** Klaviyo private key for the signup form (server only, P7-02). Unset: no signup form is rendered. */
    KLAVIYO_PRIVATE_API_KEY?: string;
    /** Klaviyo list id that signups join (server only, P7-02). Unset: no signup form is rendered. */
    KLAVIYO_LIST_ID?: string;
    /** The exact text `true` offers the optional text-message fields (P7-02); anything else is off. */
    PUBLIC_KLAVIYO_SMS_ENABLED?: string;
    /** Reviews provider id (server only, P3B-12): `judgeme`. Unset (the default): no reviews section, no request, no structured data. */
    REVIEWS_PROVIDER?: string;
    /** Judge.me PRIVATE API token (server only, P3B-12); never PUBLIC_. */
    JUDGEME_PRIVATE_API_TOKEN?: string;
    /** The store's `example.myshopify.com` domain as Judge.me knows it (server only, P3B-12). */
    JUDGEME_SHOP_DOMAIN?: string;
  }
}
