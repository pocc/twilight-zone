import { useState } from 'react';

/**
 * Step 4 "Next Steps" feedback widget. Four coarse sentiment options
 * (hate/dislike/like/love) plus an optional free-text message, POSTed to
 * `/api/feedback` which forwards to a Google Chat space via an incoming
 * webhook (see src/worker/index.ts handleFeedback). Fully self-contained:
 * it manages its own submit state and shows an inline thank-you, so no
 * toast/callback plumbing through App is required.
 *
 * `email` is the migrator's auth email (from Step 0), forwarded so the team
 * knows who to follow up with internally about that customer — only the email
 * is sent, never the API key/token. Omitted when the migration used token auth
 * (no email entered).
 */

type Sentiment = 'hate' | 'dislike' | 'like' | 'love';

const OPTIONS: { value: Sentiment; emoji: string; label: string }[] = [
  { value: 'hate', emoji: '\u{1F620}', label: 'Hate' },
  { value: 'dislike', emoji: '\u{1F641}', label: 'Dislike' },
  { value: 'like', emoji: '\u{1F642}', label: 'Like' },
  { value: 'love', emoji: '\u{1F60D}', label: 'Love' },
];

export function FeedbackCard({ email }: { email?: string }) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'accepted' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!sentiment) return;
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentiment,
          message: message.trim() || undefined,
          email: email?.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Could not send feedback (${res.status})`);
      // The server returns { ok, delivered }. `delivered` is false when no chat
      // webhook is configured or the chat POST failed — don't claim it reached
      // the team in that case (no silent "it's on its way" lie).
      const data = (await res.json().catch(() => ({}))) as { delivered?: boolean };
      setStatus(data.delivered ? 'sent' : 'accepted');
    } catch (e) {
      setError((e as Error)?.message || 'Could not send feedback');
      setStatus('error');
    }
  };

  if (status === 'sent' || status === 'accepted') {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 text-sm text-gray-300">
        <span className="text-green-400 font-bold">{'\u2713'}</span>{' '}
        {status === 'sent'
          ? <>Thanks for the feedback &mdash; it&apos;s on its way to the team.</>
          : <>Thanks for the feedback &mdash; we&apos;ve recorded it.</>}
      </div>
    );
  }

  const canSend = !!sentiment && status !== 'sending';

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-100">How was your migration?</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Pick a reaction (and add a note if you like) &mdash; it goes straight to the Twilight Zone team.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            type="button"
            key={o.value}
            onClick={() => setSentiment(o.value)}
            aria-pressed={sentiment === o.value}
            title={o.label}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg border transition ${
              sentiment === o.value
                ? 'border-orange-500 bg-orange-500/10'
                : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <span className="text-2xl leading-none" aria-hidden="true">{o.emoji}</span>
            <span className="text-[11px] font-medium text-gray-200">{o.label}</span>
          </button>
        ))}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Anything else you'd like us to know? (optional)"
        className="w-full px-3 py-2 text-sm rounded-md bg-gray-900 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
            canSend
              ? 'bg-orange-500 hover:bg-orange-400 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          {status === 'sending' ? 'Sending\u2026' : 'Send feedback'}
        </button>
      </div>
    </div>
  );
}
