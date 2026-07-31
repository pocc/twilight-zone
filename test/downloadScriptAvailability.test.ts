import { describe, expect, it } from 'vitest';

import { downloadScriptAvailability } from '../app/components/DownloadScriptButton';

describe('Download Script source-mode availability', () => {
  it('enables live API migrations', () => {
    expect(downloadScriptAvailability('api')).toEqual({ enabled: true });
  });

  it.each(['json', 'terraform'])('accurately disables %s imports instead of live-source validating them', (sourceMode) => {
    expect(downloadScriptAvailability(sourceMode as 'json' | 'terraform')).toEqual({
      enabled: false,
      reason: 'Download Script is unavailable for imported configurations because validation requires a live source zone.',
    });
  });
});
