# Running the test suite

Practical runbook for the Twilight Zone test suites. For the full
test-infrastructure reference (test config schema, E2E harness internals, the
15 E2E scenarios, evidence capture, and the operational gotchas), see
**AGENTS.md §8**. This file is the day-to-day "how do I run the tests and what
do the failures mean" guide.

## Unit tests (vitest)

```bash
npm test                 # one-shot, parallel (default)
npm run test:watch       # watch mode
npm run typecheck        # tsc --noEmit (run alongside tests before pushing)
```

Run a single file or a single test:

```bash
npx vitest run test/api.test.ts
npx vitest run test/api.test.ts -t "createZoneWithDelegation"
```

## Known flakiness: parallel-load timeouts (NOT logic failures)

**Symptom.** A run of `npm test` occasionally reports `1 failed` (rarely more),
but **a different test fails each run** — e.g. one run fails
`crypto.test.ts > round-trips a large text payload without a stack overflow`,
the next fails a fast test like
`api.test.ts > createZoneWithDelegation ... no nameservers ever appear`.

**Root cause.** This is **environmental**, not a logic bug. vitest runs test
files across parallel worker threads. A few tests are genuinely CPU-bound — the
`crypto.test.ts` cases run real PBKDF2 over large payloads and can take ~18s
under contention (vs ~3.5s idle). When the machine is loaded, those workers
starve the others, and a fast test can stall past vitest's default **5s
per-test timeout** and report as failed. Because which worker gets starved is
nondeterministic, the failing test changes run to run.

**How to confirm it's the flakiness and not a real failure.** Run the suite
single-threaded — this serializes the CPU-bound tests and removes the
contention:

```bash
npx vitest run --no-file-parallelism
```

If everything passes single-threaded, the parallel failure was load-induced
flakiness. As of this writing the full suite is **722/722 green** under
`--no-file-parallelism`. Treat the single-threaded result as authoritative when
triaging a flaky parallel run.

**Other quick checks:**

```bash
# Re-run just the test that failed; if it passes alone, it was starvation.
npx vitest run <file> -t "<failing test name>"
```

**What this is NOT.** It is not cross-file global state leakage (vitest isolates
module state per file) and not a bug in the test under test — the affected fast
tests pass in isolation and within their own describe block. Do **not** "fix" a
flaky parallel failure by relaxing the assertion of whichever test happened to
lose the scheduling race.

**Not yet addressed (deliberately).** Hardening the flakiness at its source —
e.g. bumping the timeout on the CPU-bound `crypto.test.ts` large-payload cases,
shrinking their payloads, or pinning them to a serial pool — was left out of
scope to avoid touching crypto tests during unrelated feature work. If CI starts
flaking on this, that's the place to start. CI can also just use
`--no-file-parallelism` for a deterministic (slower) signal.

## E2E integration tests (Playwright)

Driven by `scripts/run-playwright-migrations.mjs` against real Cloudflare
accounts. Full env vars, flags, the per-run unique-zone model, and the
operational gotchas (zone-creation cooldown, account-scoped resource leakage,
API rate limits, etc.) are documented in **AGENTS.md §8** — read that before
running E2E.

```bash
node scripts/run-playwright-migrations.mjs --only 1        # one scenario
node scripts/run-playwright-migrations.mjs --start 1 --end 5
HEADLESS=1 node scripts/run-playwright-migrations.mjs --only 1
```

> Note: the E2E harness drives the **migration** flow (source → dest). The
> preset modes (All Features On/Off buttons) are exercised via the migration
> flow's seeded config, not the preset endpoints directly.
