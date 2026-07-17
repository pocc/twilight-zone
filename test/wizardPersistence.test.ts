import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadWizardState,
  saveWizardState,
  clearWizardState,
  resolveInitialStep,
  type WizardSnapshot,
  type WizardSnapshotInput,
} from '../app/lib/wizardPersistence';

// Minimal in-memory localStorage stub (vitest runs in the `node` env, which has
// no localStorage). Installed before each test.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
}

function mkInput(overrides: Partial<WizardSnapshotInput> = {}): WizardSnapshotInput {
  return {
    sourceMode: 'api',
    step: 0,
    maxStepReached: 0,
    exportData: null,
    exportTimestamp: null,
    selections: {},
    conflictStrategy: 'skip',
    capabilities: null,
    existingTurnstileWidgets: [],
    doConfigs: {},
    d1Configs: {},
    acknowledgments: [],
    selectedPlan: null,
    report: null,
    accountReport: null,
    reportMarkdown: '',
    auditLog: [],
    migrationLogs: [],
    ...overrides,
  };
}

// A non-null exportData stand-in (resolveInitialStep only checks truthiness).
const SOME_EXPORT = { zone: { name: 'z' } } as unknown as WizardSnapshot['exportData'];
const SOME_REPORT = { summary: {} } as unknown as WizardSnapshot['report'];

describe('wizardPersistence.resolveInitialStep', () => {
  // The contract is URL-authoritative: apex '/' → Setup, ?step=N → exactly N
  // (range-bounded). No snapshot/data/maxStepReached clamp — the URL is never
  // silently redirected to a different step.

  it('lands on Setup (0) when ?step is absent, regardless of the snapshot', () => {
    // Apex '/' is home — never auto-restore a numbered step from the snapshot,
    // even a fully-backed one that previously sat on Results.
    const snap = { v: 1, ...mkInput({ step: 3, exportData: SOME_EXPORT, report: SOME_REPORT, maxStepReached: 4 }) } as WizardSnapshot;
    expect(resolveInitialStep(snap, '')).toBe(0);
    expect(resolveInitialStep(null, '')).toBe(0);
  });

  it('honors ?step=N verbatim even with no snapshot (URL is authoritative)', () => {
    expect(resolveInitialStep(null, '?step=2')).toBe(2);
    expect(resolveInitialStep(null, '?step=4')).toBe(4);
  });

  it('does NOT clamp ?step to snapshot data or maxStepReached', () => {
    // Previously this clamped a no-report api migration's ?step=4 down to 3 and
    // bounded by maxStepReached; now the URL wins and step 4 renders its own
    // empty Results state.
    const snap = { v: 1, ...mkInput({ sourceMode: 'api', exportData: SOME_EXPORT, maxStepReached: 1 }) } as WizardSnapshot;
    expect(resolveInitialStep(snap, '?step=4')).toBe(4);
  });

  it('honors every in-range step', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(resolveInitialStep(null, `?step=${n}`)).toBe(n);
    }
  });

  it('bounds ?step to the highest wizard step (4)', () => {
    expect(resolveInitialStep(null, '?step=9')).toBe(4);
  });

  it('returns 0 for a negative ?step', () => {
    expect(resolveInitialStep(null, '?step=-5')).toBe(0);
  });

  it('returns 0 for a non-numeric ?step', () => {
    expect(resolveInitialStep(null, '?step=banana')).toBe(0);
  });
});

describe('wizardPersistence save/load/clear', () => {
  beforeEach(() => { installLocalStorage(); });

  it('round-trips a snapshot and stamps the schema version', () => {
    saveWizardState(mkInput({ sourceMode: 'maxconfig', step: 2, maxStepReached: 2, exportData: SOME_EXPORT }));
    const loaded = loadWizardState();
    expect(loaded).not.toBeNull();
    expect(loaded!.v).toBe(1);
    expect(loaded!.sourceMode).toBe('maxconfig');
    expect(loaded!.step).toBe(2);
  });

  it('returns null when nothing is stored', () => {
    expect(loadWizardState()).toBeNull();
  });

  it('returns null on a schema-version mismatch', () => {
    localStorage.setItem('tz-wizard-state-v1', JSON.stringify({ v: 999, step: 3 }));
    expect(loadWizardState()).toBeNull();
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    localStorage.setItem('tz-wizard-state-v1', '{not json');
    expect(loadWizardState()).toBeNull();
  });

  it('clearWizardState removes the snapshot', () => {
    saveWizardState(mkInput({ step: 1 }));
    expect(loadWizardState()).not.toBeNull();
    clearWizardState();
    expect(loadWizardState()).toBeNull();
  });

  it('drops the key (no partial) when serialization throws on quota', () => {
    saveWizardState(mkInput({ step: 1 }));
    // Force setItem to throw like a QuotaExceededError on the next save.
    const ls = globalThis.localStorage;
    let removed = false;
    globalThis.localStorage = {
      ...ls,
      getItem: ls.getItem.bind(ls),
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { removed = true; },
    } as Storage;
    saveWizardState(mkInput({ step: 2, exportData: SOME_EXPORT }));
    expect(removed).toBe(true);
  });
});
