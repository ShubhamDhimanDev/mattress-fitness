import type {Config} from '@react-router/dev/config';

/**
 * Hydrogen 2026.10 no longer ships a React Router preset (ADR-0012). These are the values the 2026.4 preset applied
 * and that Shopify's 2026.10 template sets: output in `dist/` (the own-server entry reads dist/server and dist/client,
 * ADR-0011), server rendering, and middleware context (`RouterContextProvider`) for the request services.
 */
export default {
  appDirectory: 'app',
  buildDirectory: 'dist',
  ssr: true,
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: false,
    unstable_optimizeDeps: true,
  },
  // Hydrogen's CSP is nonce based; integrity attributes on the build's scripts would conflict with it.
  subResourceIntegrity: false,
} satisfies Config;
