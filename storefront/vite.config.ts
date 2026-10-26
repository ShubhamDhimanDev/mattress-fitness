import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {localHttps} from '@shopify/hydrogen/vite';
import {oxygen} from '@shopify/mini-oxygen/vite';
import {reactRouter} from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';

const oxygenPlugins = oxygen();
const oxygenPlugin = oxygenPlugins.find(
  (plugin) => plugin.name === 'oxygen:main',
);

if (!oxygenPlugin?.api) {
  throw new Error('MiniOxygen plugin API is unavailable.');
}

// MiniOxygen infers the compatibility date 2026-10-01 from Hydrogen 2026.10.x, but its runtime does not support that
// date yet (Shopify's 2026.10 template carries the same override). Remove it when MiniOxygen handles inferred dates
// its runtime cannot run. The own-server build (ADR-0011) ignores this value; it only affects `vite dev` and `preview`.
oxygenPlugin.api.registerPluginOptions({compatibilityDate: '2026-04-01'});

// `npm run dev:https` serves https://local.tryhydrogen.dev (Customer Account sign-in needs an HTTPS origin).
const httpsOptions = {enabled: process.env.npm_lifecycle_event === 'dev:https'};

export default defineConfig({
  plugins: [
    localHttps(httpsOptions),
    tailwindcss(),
    ...oxygenPlugins,
    reactRouter(),
  ],
  resolve: {
    alias: {
      // Vite's native tsconfig path resolver does not cover JavaScript
      // projects that use jsconfig.json, so define Hydrogen's app alias here.
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
    tsconfigPaths: true,
  },
  build: {
    // Allow a strict Content-Security-Policy
    // without inlining assets as base64:
    assetsInlineLimit: 0,
  },
  ssr: {
    optimizeDeps: {
      /**
       * Include dependencies here if they throw CJS<>ESM errors.
       * For example, for the following error:
       *
       * > ReferenceError: module is not defined
       * >   at /Users/.../node_modules/example-dep/index.js:1:1
       *
       * Include 'example-dep' in the array below.
       * @see https://vitejs.dev/config/dep-optimization-options
       */
      include: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/server',
        'react-router > set-cookie-parser',
        'react-router > cookie',
        'react-router',
      ],
    },
  },
  server: {
    allowedHosts: ['.tryhydrogen.dev'],
  },
});
