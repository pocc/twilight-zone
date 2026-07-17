import { useEffect } from 'react';

/**
 * Lock background scroll while an overlay (modal) is open.
 *
 * Why this isn't just `document.body.style.overflow = 'hidden'`: in twilight
 * mode the app shell is a `position: fixed`, internally-scrolling box
 * (`.tvc-host--page` in app/index.css) — the page scrolls THAT element, not
 * `body`. Locking only `body` therefore fails to stop the step content from
 * scrolling behind the modal in twilight. We lock BOTH the body (base / light /
 * dark, where the window scrolls) and the `.tvc-host--page` box (twilight when
 * present), restoring each to its prior inline value on close.
 *
 * Pass the modal's open/mounted flag as `active`; the lock applies while truthy
 * and is released on cleanup.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const host = document.querySelector<HTMLElement>('.tvc-host--page');
    const prevBody = body.style.overflow;
    const prevHost = host?.style.overflow ?? '';
    body.style.overflow = 'hidden';
    if (host) host.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      if (host) host.style.overflow = prevHost;
    };
  }, [active]);
}
