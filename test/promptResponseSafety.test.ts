import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { applyPromptResponseResult, type LogLine } from '../app/hooks/useStreamRequest';
import { selectPromptTimeoutAnswer } from '../src/worker/oauth/prompt-registry';

const promptLine = (): LogLine => ({
  message: 'Conflict?',
  type: 'prompt',
  timestamp: 1,
  prompt: {
    promptId: 'prompt-1',
    question: 'Conflict?',
    options: [
      { value: 'overwrite', label: 'Overwrite' },
      { value: 'skip', label: 'Skip' },
    ],
  },
});

describe('prompt response safety', () => {
  it('keeps a failed response visible and retryable', () => {
    const result = applyPromptResponseResult([promptLine()], 'prompt-1', 'skip', false);

    expect(result[0].prompt?.promptId).toBe('prompt-1');
    expect(result.at(-1)).toMatchObject({ type: 'error' });
    expect(result.at(-1)?.message).toMatch(/not accepted|retry/i);
  });

  it('marks a prompt answered only after the response succeeds', () => {
    const result = applyPromptResponseResult([promptLine()], 'prompt-1', 'skip', true);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'info', prompt: undefined });
    expect(result[0].message).toContain('→ skip');
  });

  it('keeps the synchronous log snapshot aligned with prompt response state', () => {
    const hookSource = readFileSync(new URL('../app/hooks/useStreamRequest.ts', import.meta.url), 'utf8');

    expect(hookSource).toContain(`setLogs(prev => {
      const next = applyPromptResponseResult(prev, promptId, answer, accepted);
      logsRef.current = next;
      return next;
    });`);
  });

  it('uses skip on timeout even when overwrite is the first option', () => {
    expect(selectPromptTimeoutAnswer(promptLine().prompt!.options)).toBe('skip');
  });

  it('can never turn a failed Skip submission into Overwrite at timeout', () => {
    const pending = applyPromptResponseResult([promptLine()], 'prompt-1', 'skip', false);

    expect(pending[0].prompt).toBeDefined();
    expect(selectPromptTimeoutAnswer(pending[0].prompt!.options)).toBe('skip');
    expect(selectPromptTimeoutAnswer(pending[0].prompt!.options)).not.toBe('overwrite');
  });

  it('aborts rather than selecting a non-skip destructive timeout fallback', () => {
    expect(() => selectPromptTimeoutAnswer([
      { value: 'overwrite', label: 'Overwrite' },
    ])).toThrow(/timed out|safe fallback/i);
  });
});
