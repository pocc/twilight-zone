// Helpers for zone settings whose API response id differs from the endpoint id.

export const DEDICATED_RUNTIME_ID_ALIASES: Record<string, string> = {
  csam_scanner: 'csam_scanner_third_party',
};

export function dedicatedEndpointId(settingId: string): string {
  return DEDICATED_RUNTIME_ID_ALIASES[settingId] ?? settingId;
}
