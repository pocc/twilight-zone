import { describe, expect, it } from 'vitest';
import { PRESET_DISABLED_STEPS, PRESET_STEPS } from '../app/components/StepIndicator';

describe('preset wizard flow', () => {
  it('keeps Account and Zone navigable for preset review', () => {
    expect(PRESET_STEPS.map(step => step.label)).toEqual(['Account', 'Zone', 'Apply', 'Results']);
    expect(PRESET_DISABLED_STEPS).toEqual([]);
  });
});
