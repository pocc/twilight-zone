// API code generators for dry-run preview (TS, curl, Python, Go, Terraform)

export interface ApiCall {
  method: string;
  endpoint: string;
  description: string;
  count: number;
}

/** Strip anything outside the safe identifier charset before interpolating an
 * ID into generated TS/curl/Python/Go. Cloudflare zone/account IDs are 32 hex
 * chars; this is defense-in-depth so a value containing shell/JS metacharacters
 * (e.g. `"; rm -rf ~ #`) can't inject into the script the user then runs. The
 * worker validates IDs as 32-hex upstream, but codegen is client-side and
 * shouldn't assume that. */
function safeId(id: string): string {
  return (id || '').replace(/[^A-Za-z0-9_-]/g, '');
}

export function generateApiCode(
  format: string, calls: ApiCall[], zoneIdRaw: string, accountIdRaw: string,
): string {
  const zoneId = safeId(zoneIdRaw);
  const accountId = safeId(accountIdRaw);
  switch (format) {
    case 'typescript': return generateTypeScript(calls, zoneId, accountId);
    case 'curl': return generateCurl(calls, zoneId, accountId);
    case 'python': return generatePython(calls, zoneId, accountId);
    case 'go': return generateGo(calls, zoneId, accountId);
    case 'terraform': return generateTerraform(calls);
    default: return generateTypeScript(calls, zoneId, accountId);
  }
}

function generateTypeScript(calls: ApiCall[], zoneId: string, accountId: string): string {
  const lines = [
    '// Cloudflare API migration calls',
    `const ZONE_ID = '${zoneId}';`,
    `const ACCOUNT_ID = '${accountId}';`,
    `const API_TOKEN = process.env.CF_API_TOKEN;`,
    '',
    'const headers = {',
    `  'Authorization': \`Bearer \${API_TOKEN}\`,`,
    `  'Content-Type': 'application/json',`,
    '};',
    '',
  ];

  for (const call of calls) {
    lines.push(`// ${call.description} (${call.count} call${call.count > 1 ? 's' : ''})`);
    const url = call.endpoint.replace(':zone_id', '${ZONE_ID}').replace(':account_id', '${ACCOUNT_ID}');
    lines.push(`await fetch(\`https://api.cloudflare.com/client/v4${url}\`, {`);
    lines.push(`  method: '${call.method}',`);
    lines.push('  headers,');
    if (call.method !== 'GET') lines.push('  body: JSON.stringify({ /* ... */ }),');
    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

function generateCurl(calls: ApiCall[], zoneId: string, accountId: string): string {
  const lines = [
    '#!/bin/bash',
    `ZONE_ID="${zoneId}"`,
    `ACCOUNT_ID="${accountId}"`,
    'API_TOKEN="$CF_API_TOKEN"',
    '',
  ];

  for (const call of calls) {
    lines.push(`# ${call.description} (${call.count} call${call.count > 1 ? 's' : ''})`);
    const url = call.endpoint.replace(':zone_id', '$ZONE_ID').replace(':account_id', '$ACCOUNT_ID');
    lines.push(`curl -X ${call.method} \\`);
    lines.push(`  "https://api.cloudflare.com/client/v4${url}" \\`);
    lines.push('  -H "Authorization: Bearer $API_TOKEN" \\');
    lines.push('  -H "Content-Type: application/json"');
    lines.push('');
  }

  return lines.join('\n');
}

function generatePython(calls: ApiCall[], zoneId: string, accountId: string): string {
  const lines = [
    'import requests',
    'import os',
    '',
    `ZONE_ID = "${zoneId}"`,
    `ACCOUNT_ID = "${accountId}"`,
    'API_TOKEN = os.environ["CF_API_TOKEN"]',
    '',
    'headers = {',
    '    "Authorization": f"Bearer {API_TOKEN}",',
    '    "Content-Type": "application/json",',
    '}',
    '',
    'BASE = "https://api.cloudflare.com/client/v4"',
    '',
  ];

  for (const call of calls) {
    lines.push(`# ${call.description} (${call.count} call${call.count > 1 ? 's' : ''})`);
    const url = call.endpoint.replace(':zone_id', '{ZONE_ID}').replace(':account_id', '{ACCOUNT_ID}');
    lines.push(`resp = requests.${call.method.toLowerCase()}(f"{BASE}${url}", headers=headers)`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateGo(calls: ApiCall[], zoneId: string, accountId: string): string {
  const lines = [
    'package main',
    '',
    'import (',
    '    "net/http"',
    '    "os"',
    ')',
    '',
    'func main() {',
    `    zoneID := "${zoneId}"`,
    `    accountID := "${accountId}"`,
    '    token := os.Getenv("CF_API_TOKEN")',
    '    base := "https://api.cloudflare.com/client/v4"',
    '',
  ];

  for (const call of calls) {
    const url = call.endpoint.replace(':zone_id', '" + zoneID + "').replace(':account_id', '" + accountID + "');
    lines.push(`    // ${call.description} (${call.count} call${call.count > 1 ? 's' : ''})`);
    lines.push(`    req, _ := http.NewRequest("${call.method}", base + "${url}", nil)`);
    lines.push('    req.Header.Set("Authorization", "Bearer " + token)');
    lines.push('    http.DefaultClient.Do(req)');
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

function generateTerraform(calls: ApiCall[]): string {
  return [
    '# Terraform equivalent resources (approximate)',
    '# Run: terraform init && terraform plan',
    '',
    'terraform {',
    '  required_providers {',
    '    cloudflare = { source = "cloudflare/cloudflare" }',
    '  }',
    '}',
    '',
    ...calls.map(c => `# ${c.method} ${c.endpoint} - ${c.description} (${c.count} calls)`),
    '',
    '# Use `terraform import` to import existing resources',
  ].join('\n');
}

export function getCodeFileExtension(format: string): string {
  switch (format) {
    case 'typescript': return '.ts';
    case 'curl': return '.sh';
    case 'python': return '.py';
    case 'go': return '.go';
    case 'terraform': return '.tf';
    default: return '.txt';
  }
}
