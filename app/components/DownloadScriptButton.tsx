import { useCallback, useState } from 'react';
import { validateMigration, type Credentials, type PlannedApiCall } from '../lib/api';
import { generateApiCode, getCodeFileExtension } from '../lib/codegen';

const CODE_FORMATS = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'curl', label: 'curl' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'terraform', label: 'Terraform' },
] as const;

function download(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface DownloadScriptButtonProps {
  creds: Partial<Credentials>;
  sourceZoneId: string;
  sourceAccountId: string;
  destAccountId: string;
  domainName?: string;
  /** Same gate as the deploy action — disabled until blockers are resolved. */
  disabled?: boolean;
}

/**
 * #19 Part D — "Download planned API calls as a script". Fetches the planned
 * WRITE calls for the full migration from the dry-run `/api/validate` path (the
 * SAME pure preview the migrate engine uses, so the script matches a real run)
 * and emits a runnable scaffold in the chosen language. The generated code reads
 * `CF_API_TOKEN` from the environment — it NEVER embeds the user's real token or
 * key (AGENTS.md §7 / codegen.ts). The planned calls are cached after the first
 * fetch so switching languages doesn't re-export the zone.
 */
export function DownloadScriptButton({
  creds, sourceZoneId, sourceAccountId, destAccountId, domainName, disabled,
}: DownloadScriptButtonProps) {
  const [format, setFormat] = useState('typescript');
  const [calls, setCalls] = useState<PlannedApiCall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = useCallback(async () => {
    setError('');
    try {
      let planned = calls;
      if (!planned) {
        setLoading(true);
        const res = await validateMigration(creds, sourceZoneId, sourceAccountId, destAccountId, domainName);
        planned = res.apiCalls ?? [];
        setCalls(planned);
      }
      // Dest zone doesn't exist yet pre-run, so ZONE_ID is left as a placeholder
      // the user fills after `POST /zones`; the dest account ID is known.
      const code = generateApiCode(format, planned, '', destAccountId);
      download(code, `migration-api-calls${getCodeFileExtension(format)}`);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to generate script');
    } finally {
      setLoading(false);
    }
  }, [calls, creds, sourceZoneId, sourceAccountId, destAccountId, domainName, format]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor="download-script-format" className="text-xs text-gray-400 shrink-0">
          Download as script:
        </label>
        <select
          id="download-script-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          disabled={disabled || loading}
          className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-orange-500 focus:outline-none disabled:opacity-50"
        >
          {CODE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <button
          type="button"
          onClick={handleDownload}
          disabled={disabled || loading}
          title="Download the planned migration as a runnable script (no credentials embedded)"
          className={`px-3 py-1.5 rounded text-xs font-medium transition ${
            disabled || loading
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
        >
          {loading ? 'Generating…' : 'Download'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
