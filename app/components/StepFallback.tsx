/**
 * Visual placeholder rendered while a lazy-loaded wizard step is being
 * fetched and parsed. Sized to roughly match a step's natural footprint
 * so the layout doesn't jump. The user only sees this for ~50-300 ms
 * on first navigation to a step; subsequent visits hit the cache and
 * are instant.
 */
export function StepFallback() {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 animate-pulse">
        <div className="h-3 w-32 bg-gray-700 rounded mb-3" />
        <div className="h-2 w-full bg-gray-700/60 rounded mb-2" />
        <div className="h-2 w-3/4 bg-gray-700/60 rounded" />
      </div>
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 animate-pulse">
        <div className="h-3 w-24 bg-gray-700 rounded mb-3" />
        <div className="h-2 w-full bg-gray-700/60 rounded mb-2" />
        <div className="h-2 w-5/6 bg-gray-700/60 rounded mb-2" />
        <div className="h-2 w-2/3 bg-gray-700/60 rounded" />
      </div>
      <p className="text-xs text-gray-500 text-center">Loading step…</p>
    </div>
  );
}
