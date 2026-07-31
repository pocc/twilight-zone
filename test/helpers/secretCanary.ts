export type BrowserArtifacts = {
  storage: {
    session: Record<string, string>;
    local: Record<string, string>;
  };
  logs: unknown[];
  errors: unknown[];
  sse: unknown[];
  reports: unknown[];
  analytics: unknown[];
  downloads: { name: string; body: string }[];
};

export type SecretCanaryFinding = {
  path: string;
  canary: string;
};

export const emptyBrowserArtifacts = (): BrowserArtifacts => ({
  storage: { session: {}, local: {} },
  logs: [],
  errors: [],
  sse: [],
  reports: [],
  analytics: [],
  downloads: [],
});

export const emptyBrowserArtifactCategories = (artifacts: BrowserArtifacts): string[] => [
  ['storage.session', Object.keys(artifacts.storage.session).length],
  ['storage.local', Object.keys(artifacts.storage.local).length],
  ['logs', artifacts.logs.length],
  ['errors', artifacts.errors.length],
  ['sse', artifacts.sse.length],
  ['reports', artifacts.reports.length],
  ['analytics', artifacts.analytics.length],
  ['downloads', artifacts.downloads.length],
].filter((entry) => entry[1] === 0).map((entry) => String(entry[0]));

export const scanSecretCanaries = (
  value: unknown,
  canaries: string[],
): SecretCanaryFinding[] => {
  const findings: SecretCanaryFinding[] = [];
  const visited = new WeakSet<object>();

  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string') {
      for (const canary of canaries) {
        if (canary && current.includes(canary)) findings.push({ path, canary });
      }
      return;
    }
    if (typeof current !== 'object' || current === null || visited.has(current)) return;
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(current)) visit(nested, `${path}.${key}`);
  };

  visit(value, '$');
  return findings;
};
