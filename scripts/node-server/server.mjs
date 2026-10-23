// Production entry for running the built storefront on a plain Node server (ADR-0010, task P9-12).
//
//   cd storefront && npm run build && npm run start:node
//
// It loads the bundle that `shopify hydrogen build` writes (storefront/dist/server/index.js, whose default export is the
// same `{fetch}` handler as storefront/server.ts, security headers included), serves storefront/dist/client, and reads the
// storefront's configuration from this process's environment. Nothing in the application changes for this host.
// Host settings (PORT, BIND_HOST, TRUST_PROXY, MAX_BODY_BYTES, SHUTDOWN_TIMEOUT_MS, CACHE_MAX_ENTRIES, CACHE_MAX_BYTES) are in config.mjs.
// Behind a reverse proxy, set TRUST_PROXY=true; see docs/deployment/VPS_RUNBOOK.md.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNodeServer, errorName } from './adapter.mjs';
import { createCacheStorage } from './cache.mjs';
import { readSettings, readStorefrontProblems } from './config.mjs';

const storefrontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storefront');

/** One JSON line per event on stderr/stdout via console.warn/error, the same shape and streams the storefront logs on. */
function log(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

async function main() {
  const { settings, problems } = readSettings(process.env);
  const storefrontProblems = readStorefrontProblems(process.env);
  if (problems.length > 0 || storefrontProblems.length > 0) {
    // Names only, never values. Refusing to start makes a bad deployment fail at the restart instead of as 500s later.
    log('error', 'node_server.config_invalid', { problems: [...problems, ...storefrontProblems] });
    process.exit(1);
  }

  // The bundle uses the Workers `caches` global at request time (app/lib/context.ts, replay-store); install the stand-in first.
  globalThis.caches = createCacheStorage({ maxEntries: settings.cacheMaxEntries, maxBytes: settings.cacheMaxBytes });

  const buildFile = path.join(storefrontDir, 'dist/server/index.js');
  let handler;
  try {
    ({ default: handler } = await import(pathToFileURL(buildFile).href));
  } catch (error) {
    log('error', 'node_server.build_missing', { error: errorName(error), file: 'dist/server/index.js' });
    process.exit(1);
  }
  if (typeof handler?.fetch !== 'function') {
    log('error', 'node_server.build_invalid', { reason: 'default export has no fetch function' });
    process.exit(1);
  }

  // A plain copy: the handler reads its configuration from this object, never from process.env (ADR-0004).
  const env = { ...process.env };
  const { server, close } = createNodeServer({
    handler,
    env,
    clientDir: path.join(storefrontDir, 'dist/client'),
    settings,
    log,
  });

  server.listen(settings.port, settings.bindHost, () => {
    log('warn', 'node_server.listening', {
      host: settings.bindHost,
      port: settings.port,
      trustProxy: settings.trustProxy,
      nodeEnv: process.env.NODE_ENV ?? null,
    });
  });
  server.on('error', (error) => {
    log('error', 'node_server.listen_failed', { error: errorName(error), code: error.code ?? null });
    process.exit(1);
  });

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log('warn', 'node_server.stopping', { signal });
    close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // Decision (VPS_RUNBOOK, "Process manager"): log the error name and keep serving. The storefront guards its own
  // background work, so a stray rejection is a bug to alert on (node_server.unhandled_rejection), not a reason to drop
  // every shopper's in-flight request. An uncaught exception is not caught: the process exits and systemd restarts it.
  process.on('unhandledRejection', (reason) => {
    log('error', 'node_server.unhandled_rejection', { error: errorName(reason) });
  });
}

await main();
