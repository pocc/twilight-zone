// Pure curl→request parser for the pre-cutover uptime monitor.
// Parses a pasted `curl` command into editable {url, method, headers, body}
// fields. The fields (not the raw curl) are the source of truth sent to the
// host-locked /api/monitor/ping endpoint, so the user can paste-then-tweak.
//
// Handles the common flags: -X/--request, -H/--header, -d/--data/--data-raw/
// --data-binary, -A/--user-agent, -b/--cookie, -e/--referer, --url, and a
// positional URL. Unknown flags are skipped gracefully. Pure (no I/O), fully
// unit tested.

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Tokenize a shell-ish command honoring single/double quotes and backslash
 * line continuations. Good enough for pasted curl commands (not a full shell). */
export function tokenizeCurl(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    let tok = '';
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === "'") {
        i++;
        while (i < s.length && s[i] !== "'") { tok += s[i]; i++; }
        i++; // closing quote
      } else if (c === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length) { tok += s[i + 1]; i += 2; }
          else { tok += s[i]; i++; }
        }
        i++; // closing quote
      } else if (c === '\\' && i + 1 < s.length) {
        tok += s[i + 1]; i += 2;
      } else {
        tok += c; i++;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

function splitHeader(raw: string): [string, string] | null {
  const idx = raw.indexOf(':');
  if (idx === -1) return null;
  return [raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()];
}

/**
 * Parse a pasted curl command. Returns null if no URL could be found.
 * Method defaults to GET, or POST when a body (-d/--data) is present and no
 * explicit -X was given (matching curl's own behavior).
 */
export function parseCurl(input: string): ParsedCurl | null {
  const tokens = tokenizeCurl(input);
  let url = '';
  let method = '';
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let sawData = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i];
    if (t === 'curl') continue;
    if (t === '-X' || t === '--request') { method = (next() || '').toUpperCase(); }
    else if (t === '-H' || t === '--header') {
      const h = splitHeader(next() || '');
      if (h && h[0]) headers[h[0]] = h[1];
    }
    else if (t === '-A' || t === '--user-agent') { headers['User-Agent'] = next() || ''; }
    else if (t === '-b' || t === '--cookie') { headers['Cookie'] = next() || ''; }
    else if (t === '-e' || t === '--referer') { headers['Referer'] = next() || ''; }
    else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      body = (body ? body + '&' : '') + (next() || ''); sawData = true;
    }
    else if (t === '--url') { url = next() || ''; }
    else if (t.startsWith('http://') || t.startsWith('https://')) { if (!url) url = t; }
    // Unknown flags (-s, -k, -L, --compressed, …) are treated as boolean: we do
    // NOT consume the following token, so a trailing positional URL still
    // parses. (A previous empty `else if (t.startsWith('-'))` branch did
    // nothing — removed.) Bare positional non-URL tokens are ignored.
  }

  if (!url) return null;
  if (!method) method = sawData ? 'POST' : 'GET';
  return { url, method, headers, body };
}
