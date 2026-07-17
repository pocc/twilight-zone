import React from 'react';

/**
 * App-level error boundary for the wizard content.
 *
 * This is a CLASS component by necessity: React error boundaries require
 * `getDerivedStateFromError` / `componentDidCatch`, which have no hook
 * equivalent (React 19). It is the documented exception to the
 * functional-components-only rule.
 *
 * Why it exists: the wizard steps are React.lazy chunks. If a chunk fails to
 * load — most commonly because a new deploy replaced the chunk hashes the
 * running page references — the rejected dynamic import propagates uncaught
 * past <Suspense> (which only handles the *pending* state, not rejection) and
 * unmounts the entire React tree, leaving a completely black screen. This
 * boundary catches that and either auto-reloads to fetch the fresh assets
 * (the stale-deploy case) or shows an actionable Reload UI instead of a blank
 * page.
 */

const CHUNK_ERROR_RE =
  /(Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|ChunkLoadError)/i;

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'ChunkLoadError') return true;
  return typeof e.message === 'string' && CHUNK_ERROR_RE.test(e.message);
}

// Guard against reload loops: if a single hard reload doesn't resolve the
// chunk failure (asset genuinely unavailable, not just stale), fall through to
// the manual UI rather than reloading forever.
const RELOAD_GUARD_KEY = 'tz-chunk-reload-at';
const RELOAD_DEBOUNCE_MS = 15_000;

type Props = { children: React.ReactNode };
type State = { error: Error | null; reloading: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    if (isChunkLoadError(error)) {
      // Stale-deploy recovery: pull the fresh index.html + matching chunks with
      // one hard reload, unless we already tried very recently.
      let last = 0;
      try {
        last = parseInt(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0', 10) || 0;
      } catch {
        /* sessionStorage unavailable — fall through to manual UI */
      }
      if (Date.now() - last > RELOAD_DEBOUNCE_MS) {
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
        this.setState({ reloading: true });
        location.reload();
        return;
      }
    }
    // Surface for the browser console / support bundles. Not a substitute for
    // the visible fallback below.
    console.error('[twilight-zone] uncaught render error:', error);
  }

  private handleReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* ignore */
    }
    location.reload();
  };

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="py-16 text-center text-sm text-gray-400">
          Reloading the latest version…
        </div>
      );
    }

    const chunk = isChunkLoadError(error);
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-red-800 bg-red-900/20 p-6 text-center">
        <div className="text-base font-semibold text-red-200">
          {chunk ? 'Couldn’t load this step' : 'Something went wrong'}
        </div>
        <p className="text-xs text-red-300/80">
          {chunk
            ? 'Part of the app failed to load — this usually happens right after a new version is deployed. Reloading should fix it. Your migration progress is preserved.'
            : 'The page hit an unexpected error. Your migration data is preserved, so reloading is safe.'}
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-400"
        >
          Reload
        </button>
      </div>
    );
  }
}
