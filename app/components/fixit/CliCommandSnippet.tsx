/**
 * Copy-to-clipboard CLI command snippet for the OutOfScopePanel.
 *
 * Renders next to ack-only IMPOSSIBLE_TO_MIGRATE items whose "fix" is
 * a well-known external CLI command (wrangler / rclone). Purely
 * informational - the ack checkbox still gates Continue. We can't
 * run wrangler for the user; this puts the exact command on their
 * clipboard so they can paste it into a terminal post-migration.
 *
 * Per AGENTS.md Principle 4: this affordance respects the constraint
 * that the user is the actor (they run the command). The principle
 * forbids "you must acknowledge that X happens automatically" - it
 * does NOT forbid "you must acknowledge X; by the way, here's the
 * exact command for X."
 */

import React, { useState } from 'react';
import { Copy, Check } from '@phosphor-icons/react';
import type { CliCommand } from '../../lib/outOfScope';

interface CliCommandSnippetProps {
  /** Title for the snippet (e.g. "Export schema from source: mydb"). */
  label: string;
  /** Verbatim command the user should copy and paste into a shell. */
  command: string;
  /** Optional inline guidance shown beneath the command. */
  note?: string;
}

export function CliCommandSnippet({ label, command, note }: CliCommandSnippetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      // Auto-revert after 1.5s so the user can copy again without
      // confusion. If they navigate away mid-timeout the unmount
      // discards the timer naturally.
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard.writeText can reject if the page is not
      // served over HTTPS or the user denied clipboard permission.
      // We silently no-op here - the command is still visible and
      // the user can manually select + copy. Adding a toast for
      // clipboard failures would be more noise than signal.
    }
  };

  return (
    <div className="rounded border border-gray-700 bg-gray-900/60 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-gray-300 font-medium truncate" title={label}>
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition flex-shrink-0 ${
            copied
              ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
              : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500'
          }`}
          aria-label={copied ? 'Copied to clipboard' : 'Copy command to clipboard'}
        >
          {copied ? (
            <>
              <Check size={11} weight="bold" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy size={11} weight="bold" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>
      {/* Use <code> + overflow-x-auto rather than <pre> so a very
          long command line stays in a single horizontal scroll
          region - wrapping a shell command breaks copy-paste. */}
      <code className="block w-full overflow-x-auto whitespace-pre text-gray-100 font-mono leading-relaxed py-1">
        {command}
      </code>
      {note && (
        <div className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
          {note}
        </div>
      )}
    </div>
  );
}

/** Convenience wrapper: render a list of CliCommands in a vertical
 * stack. Returns null for an empty/undefined list so callers can use
 * `<CliCommandList commands={item.cliCommands} />` unconditionally. */
export function CliCommandList({ commands }: { commands?: CliCommand[] }) {
  if (!commands || commands.length === 0) return null;
  return (
    <div className="space-y-2">
      {commands.map((cmd, i) => (
        <CliCommandSnippet
          key={`${cmd.label}-${i}`}
          label={cmd.label}
          command={cmd.command}
          note={cmd.note}
        />
      ))}
    </div>
  );
}
