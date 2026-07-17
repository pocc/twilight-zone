// Shared dev-server lifecycle for the E2E harness + parallel orchestrator.
//
// The harness drives the app UI over HTTP; it needs a dev server running. Rather
// than make the caller start one (and fail with a "start it yourself" error), we
// auto-start `npm run dev` on a free port when nothing is reachable, and stop it
// at teardown. Starting a dev server is non-destructive, so we just do it.
//
// Extracted so the orchestrator can start ONE shared server and hand its URL to
// every child (children then find it reachable and never each spawn their own —
// which would race on port 5173 under parallelism).

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is something serving HTTP at `url` right now? (<3s, never throws.) */
export async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

/** An OS-assigned ephemeral port that's free across interfaces right now. */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Ensure a dev server is serving the UI.
 *
 * @param {string} desiredUrl   where to look first (e.g. process DEV_SERVER_URL or default)
 * @param {object} [opts]
 * @param {(m:string)=>void} [opts.log]    logger (default console.log)
 * @param {string} [opts.outDir]           dir for the dev-server log file
 * @returns {Promise<{ url: string, started: boolean, stop: () => void }>}
 *   `url` is the reachable server (possibly a different port than requested).
 *   `stop()` kills the server ONLY if we started it (no-op for a pre-existing one).
 *
 * Only auto-starts for a LOCAL host; a remote/explicit host throws (can't start it).
 */
export async function ensureDevServer(desiredUrl, { log = console.log, outDir } = {}) {
  if (await isReachable(desiredUrl)) {
    log(`✓ Using already-running dev server at ${desiredUrl}`);
    return { url: desiredUrl, started: false, stop() {} };
  }

  let hostname = 'localhost';
  let preferredPort = 5173;
  try {
    const u = new URL(desiredUrl);
    hostname = u.hostname;
    preferredPort = Number(u.port) || 5173;
  } catch { /* keep defaults */ }
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(`Dev server not reachable at ${desiredUrl} (non-local host — cannot auto-start). Start it and retry.`);
  }

  // Log file shared across attempts.
  let stdio = 'ignore';
  let logPath = null;
  let logFd = null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    logPath = path.join(outDir, 'dev-server.log');
    logFd = fs.openSync(logPath, 'w');
    stdio = ['ignore', logFd, logFd];
  }

  const killTree = (child) => {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); }       // negative pid → whole group
    catch { try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ } }
  };

  // Don't trust a pre-bind free-check — Vite is the authority on whether a port
  // is bindable (a wedged server or an IPv4/IPv6-interface holder can make a
  // pre-check lie). Try the preferred port first; if the child dies early
  // (port-in-use) or never serves, retry on an OS-assigned ephemeral port.
  const ATTEMPTS = 3;
  let lastReason = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const port = attempt === 0 ? preferredPort : await ephemeralPort();
    const url = `http://localhost:${port}`;
    log(`🚀 Starting dev server on port ${port} (npm run dev)${attempt > 0 ? ' — retry on a fresh port' : ''}...`);

    const child = spawn('npm', ['run', 'dev'], {
      env: { ...process.env, DEV_PORT: String(port) },
      stdio,
      detached: true, // own process group so stop() kills npm → vite → workerd
    });
    let exited = false;
    child.on('exit', () => { exited = true; });
    child.on('error', (e) => { exited = true; log(`  ⚠ dev server failed to spawn: ${e.message}`); });

    // Up when reachable; bail immediately if the child dies (Vite exits fast on
    // port-in-use), so we retry on a fresh port instead of waiting out 120s.
    const start = Date.now();
    let up = false;
    while (Date.now() - start < 120000) {
      if (exited) break;
      if (await isReachable(`${url}/api/version`)) { up = true; break; }
      await sleep(1000);
    }
    if (up) {
      log(`✓ Dev server ready at ${url} (auto-started; stops at teardown)`);
      return { url, started: true, stop: () => killTree(child) };
    }
    killTree(child);
    lastReason = exited ? `it exited early (port ${port} in use?)` : `it never became reachable on port ${port}`;
    log(`  ⚠ Dev server didn't come up — ${lastReason}.${attempt < ATTEMPTS - 1 ? ' Retrying on a fresh port…' : ''}`);
  }
  throw new Error(`Could not start a dev server after ${ATTEMPTS} attempts (${lastReason})${logPath ? `; see ${logPath}` : ''}.`);
}
