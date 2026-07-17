import type { ConflictStrategy } from './groups';

// Shared "If a resource already exists on the destination" Skip/Overwrite
// toggle (the yellow box). Lives in the Setup step now — shown for presets
// that target an existing zone and for migrations whose destination zone
// already exists. The parent owns conflictStrategy + the destructive
// Skip→Overwrite confirmation modal; this is pure presentation.
//
// Behavior contract (identical to the historical copies it replaces):
//  - Skip is the safe direction → applied immediately via onSkip().
//  - Overwrite is destructive → onRequestOverwrite() opens the parent's
//    confirmation modal. Already-overwrite is a no-op (no re-prompt).
interface ConflictStrategyToggleProps {
  conflictStrategy: ConflictStrategy;
  onSkip: () => void;
  onRequestOverwrite: () => void;
}

export function ConflictStrategyToggle({
  conflictStrategy,
  onSkip,
  onRequestOverwrite,
}: ConflictStrategyToggleProps) {
  return (
    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-200">If a resource already exists on the destination</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {conflictStrategy === 'skip'
              ? 'Existing resources will be preserved and the source copy skipped'
              : 'Existing resources will be replaced with the source copy'}
          </div>
        </div>
        <div className="flex bg-gray-700 rounded-lg p-0.5 shrink-0 ml-4">
          <button type="button"
            onClick={onSkip}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              conflictStrategy === 'skip' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Skip
          </button>
          <button type="button"
            onClick={() => {
              // Already in overwrite — no-op, no modal.
              if (conflictStrategy === 'overwrite') return;
              onRequestOverwrite();
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              conflictStrategy === 'overwrite' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}
