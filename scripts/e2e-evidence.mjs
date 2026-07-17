import fs from 'node:fs';
import path from 'node:path';

function safeTimestamp(timestamp) {
  return timestamp.replace(/[:.]/g, '-');
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === 'evidence') continue;
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function runTestDirs(outputDir) {
  const summaryPath = path.join(outputDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) return [];
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const results = Array.isArray(summary?.results) ? summary.results : [];
    return results
      .map(r => {
        const rank = Number(r.rank);
        const company = String(r.company || '');
        if (!rank || !company) return '';
        const prefix = `e${String(rank).padStart(2, '0')}-`;
        return fs.readdirSync(outputDir).find(entry => entry.startsWith(prefix));
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function preserveE2eEvidence({ outputDir, timestamp }) {
  const bundleDir = path.join(outputDir, 'evidence', `run-${safeTimestamp(timestamp)}`);
  fs.mkdirSync(bundleDir, { recursive: true });
  const entries = new Set(['summary.json', 'report.md', 'run-log.txt', ...runTestDirs(outputDir)]);
  for (const entry of entries) {
    const src = path.join(outputDir, entry);
    if (!fs.existsSync(src)) continue;
    copyRecursive(path.join(outputDir, entry), path.join(bundleDir, entry));
  }
  return bundleDir;
}
