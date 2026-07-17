import React from 'react';
import { Check } from '@phosphor-icons/react';

export interface Step {
  number: number;
  label: string;
}

/**
 * Legacy 4-step set. The #19 two-phase renumber has landed: App.tsx now passes
 * MIGRATION_STEPS / PRESET_STEPS explicitly (see App.tsx render), so this set is
 * NO LONGER used by the live wizard. It is retained only as the component's
 * non-breaking default for any caller that doesn't pass an explicit `steps`
 * prop (and for tests). Prefer MIGRATION_STEPS / PRESET_STEPS in new code.
 */
export const LEGACY_STEPS: Step[] = [
  { number: 1, label: 'Setup' },
  { number: 2, label: 'Scope' },
  { number: 3, label: 'Migrate' },
  { number: 4, label: 'Results' },
];

/**
 * #19 two-phase migration set (api + json/terraform import modes).
 *
 * The "Setup" (credentials) page is the landing screen = step 0, NOT a numbered
 * wizard step — it never carries a circle. The four numbered steps are the
 * engine phases that follow: Account → Zone → Apply → Results. The strip is
 * shown on the landing screen too, but with nothing selected (all four greyed)
 * until the user advances past Setup.
 *
 * NOTE on numbering: these `number`s (1–4) are the SAME values App's `step`
 * state uses (0 = Setup/landing, 1 = Account … 4 = Results), so App passes
 * `currentStep={step}` / `maxStepReached={maxStepReached}` and maps
 * `onStepClick(s) → goToStep(s)` with no offset. On the landing screen step is
 * 0, which matches no numbered step (1–4), so none is active.
 */
export const MIGRATION_STEPS: Step[] = [
  { number: 1, label: 'Account' },
  { number: 2, label: 'Zone' },
  { number: 3, label: 'Apply' },
  { number: 4, label: 'Results' },
];

/**
 * Preset step set (MaxConfig/MinConfig). Presets aren't migrations — they apply
 * a canned config to one existing zone — but they still use the Account/Zone
 * review split so users can audit account-scoped and zone-scoped changes before
 * the destructive Apply step.
 */
export const PRESET_STEPS: Step[] = [
  { number: 1, label: 'Account' },
  { number: 2, label: 'Zone' },
  { number: 3, label: 'Apply' },
  { number: 4, label: 'Results' },
];
export const PRESET_DISABLED_STEPS: number[] = [];

interface StepIndicatorProps {
  currentStep: number;
  maxStepReached?: number;
  onStepClick?: (step: number) => void;
  /** Step set to render. Defaults to the 5-step migration set. */
  steps?: Step[];
  /** Step numbers that are inert/greyed (e.g. Account+Zone for presets). */
  disabledSteps?: number[];
}

/**
 * Wizard progress indicator. Rendered as semantic <nav><ol> so screen
 * readers announce "Step 2 of 5, current" rather than a meaningless
 * cluster of buttons. aria-current="step" marks the active step.
 *
 * `steps` is mode-driven by App (migration vs preset), and `disabledSteps`
 * greys out steps that don't apply in the current mode (they're never active
 * and never clickable).
 */
export function StepIndicator({
  currentStep,
  maxStepReached,
  onStepClick,
  steps = LEGACY_STEPS,
  disabledSteps,
}: StepIndicatorProps) {
  const maxReached = maxStepReached ?? currentStep;
  const isDisabled = (n: number) => !!disabledSteps?.includes(n);
  return (
    <nav aria-label="Migration wizard progress">
      <ol className="flex items-center justify-center flex-wrap gap-1 list-none">
        {steps.map((step, i) => {
          const disabled = isDisabled(step.number);
          const isActive = step.number === currentStep && !disabled;
          const isCompleted = step.number < currentStep && !disabled;
          const isVisited = !disabled && step.number <= maxReached && step.number !== currentStep;
          const isClickable = isVisited && !!onStepClick;

          return (
            <React.Fragment key={step.number}>
              {i > 0 && (
                <li
                  aria-hidden="true"
                  className={`h-0.5 w-8 sm:w-12 ${
                    isCompleted || (step.number <= maxReached && i < maxReached)
                      ? 'bg-orange-500'
                      : 'bg-gray-600'
                  }`}
                />
              )}
              <li>
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(step.number)}
                  disabled={!isClickable}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`Step ${step.number}: ${step.label}${
                    disabled ? ' (not applicable)' : isActive ? ' (current)' : isCompleted ? ' (completed)' : ''
                  }`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                      : disabled
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed opacity-50'
                        : isVisited
                          ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 cursor-pointer'
                          : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                    isActive ? 'bg-white text-orange-500' : isVisited ? 'bg-orange-500 text-white' : 'bg-gray-600 text-gray-400'
                  }`}>
                    {isCompleted
                      ? <Check size={12} weight="bold" aria-hidden="true" />
                      : step.number}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
