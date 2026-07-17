import { describe, it, expect } from 'vitest';
import { formatFeedbackMessage } from '../src/worker/index';

// formatFeedbackMessage builds the Google Chat text for a feedback submission.
// The migrator's email is included so the team can follow up internally; the
// API key/token is never part of this payload (it isn't passed in here at all).
describe('formatFeedbackMessage', () => {
  it('includes the sentiment label as the header', () => {
    expect(formatFeedbackMessage('\u{1F60D} Love', '', '')).toBe(
      '*Twilight Zone feedback* — \u{1F60D} Love',
    );
  });

  it('adds a "From:" line with the email when present', () => {
    const text = formatFeedbackMessage('\u{1F642} Like', '', 'user@example.com');
    expect(text).toBe('*Twilight Zone feedback* — \u{1F642} Like\nFrom: user@example.com');
  });

  it('appends the free-text message after the email', () => {
    const text = formatFeedbackMessage('\u{1F620} Hate', 'broke my zone', 'admin@example.com');
    expect(text).toBe(
      '*Twilight Zone feedback* — \u{1F620} Hate\nFrom: admin@example.com\nbroke my zone',
    );
  });

  it('omits the "From:" line entirely when no email is supplied (token auth)', () => {
    const text = formatFeedbackMessage('\u{1F642} Like', 'nice tool', '');
    expect(text).toBe('*Twilight Zone feedback* — \u{1F642} Like\nnice tool');
    expect(text).not.toContain('From:');
  });

  it('keeps email and message order stable (From before message)', () => {
    const text = formatFeedbackMessage('\u{1F641} Dislike', 'msg', 'a@b.com');
    expect(text.indexOf('From:')).toBeLessThan(text.indexOf('msg'));
  });
});
