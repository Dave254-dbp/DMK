# Development workflow

Use Node.js 22+ in the existing `/workspace/DMK` checkout. Preserve existing
changes; cloud tasks are isolated, so create a Git worktree only when requested.

## Install, test, run

```sh
npm ci --cache /workspace/.npm-cache --ignore-scripts --no-audit --no-fund
npm test
npm run run
npm run audit:structural
npm run run:execution
```

PineTS 0.11.0 executes `DMK.pine` directly. No API credentials, network quotes,
or local server are needed for the default fixture. Its six native tiers
aggregate the same synthetic 5m history from January 2018 to January 2026,
including calendar months and Monday-based weeks. The run evaluates the last
3,000 5m bars with retained higher-tier warm-up.

Outputs are `.dmk-results/chart.svg`, `summary.json`, and `latest.json`.
The JSON includes the source SHA-256, settings, warnings, and signal counts.
These historical fixture outputs do not establish TradingView compatibility
or realtime alert delivery.

## Use supplied candles or inputs

```sh
npm run run -- --data bundle.json --bars 3000 --inputs inputs.json
```

`bundle.json` is an object with `symbol` and `timeframes`. For the default 5m
workflow, supply ascending candle arrays under `5`, `60`, `240`, `D`, `W`, and
`M`. Each row needs finite numeric `openTime`, `closeTime`, `open`, `high`, `low`,
`close`, and `volume`; times are Unix milliseconds. Supply coherent native
aggregations of the same instrument, including enough Monthly/Weekly history
for pivots, ATR, and subsequent breaks. `--bars` accepts a positive integer.
The structural audit uses every supplied execution candle when `--bars` is
omitted; the synthetic demonstration defaults to 3,000 bars. An explicit
`--bars` selects the latest requested window and is recorded in the report.

Without overrides the provider uses UTC and a continuous 24/7 session. A bundle
can include `symbolInfo` with `mintick`, `pricescale`, `type`, `timezone`,
`session` and optional `pipSize`. Set these to match the feed. Native daily,
weekly and monthly candles must retain the provider's session boundaries;
metadata alone does not reaggregate incorrectly supplied candles.
The native execution runner requires an explicit positive `mintick` for custom
data. The JS auditor leaves unknown points/pips unavailable and uses no tick
buffer unless its actual instrument increment is supplied; it does not treat
a generic runtime precision placeholder as EUR/USD metadata.
`--timeframe` defaults to `5`; the source rejects charts of 1H or higher.

Input overrides use the exact input titles as JSON keys, for example:

```json
{"Require 4H half-range pullback": true, "Show six-tier dashboard": false}
```

## Validation record

- **20 logic tests:** execute the changed source blocks as native Pine fixtures,
  including hidden pivots, retained order, empty/100-entry arrays, threshold
  equality, and missing/neutral/opposing optional tiers in both directions.
  The original v0.2 source fails nine of these assertions; v0.3 passes all 20.
- **4 integration tests:** execute the entire six-tier source, exercise buy and
  mirrored sell paths, reject a 1H chart, and apply display input overrides.
- **Legacy catalog integration:** preserves every original A+ label and checks
  that its observations use completed candles without inferred trade outcomes.
- **Execution audit tests:** exercise structural sequence selection, frozen
  liquidity levels, no-lookahead, long/short retests, invalidations, expiry,
  active gaps, breakeven rules, overlap accounting and OHLC ambiguity.
- **Default run:** 35 A+ buys, four bullish and four bearish CHoCH warnings,
  with no runtime warnings in the latest 3,000 synthetic bars.

## TradingView validation

These checks are optional for running locally and required before claiming
TradingView validation:

1. Paste all of `DMK.pine` into Pine Editor, save, and add it to a standard 5m
   candlestick chart. Record the revision, symbol, inputs, and compiler result.
2. Replay BOS/CHoCH/MSS, compare closed-bar labels after reload, inspect native
   timeframe boundaries, and check cooldown, grading, location, and display inputs.
3. Confirm the 1H restriction. Test actual realtime alerts with **Once Per Bar
   Close**, recreating alerts after source/input changes because they retain snapshots.

These checks have not been independently performed here. The user's screenshot
shows `DMK Execution` loaded in TradingView; formal compiler verification,
replay/reload comparison and live-alert checks remain pending.

## Structural version and complete reports

Use `DMK-execution.pine` for structural levels and outcome labels. The separate
`DMK.pine` file and `npm run audit:catalog` preserve old alignment signals.
`npm run audit:structural` executes the original native tiers with causal audit
observations, selects strict structural orders, audits subsequent retests, and
creates `.dmk-results/structural-audit.json` and `.html`. With no data argument,
all prices are simulated. Supply a native history bundle to audit market data.

`--rules rules.json` accepts `entryMode` (`midpoint` or `near-edge`),
`targetMode` (`nearest-liquidity` or `pdh-pdl-only`), `stopBufferTicks`,
`expiryBars`, `sequenceExpiryBars`, `includeB`, `allowOpposingOptional`,
`tickSize`, `pipSize`, `includeRReferences` and optional `breakevenAfterR`.
Breakeven is disabled by default. Native Pine input titles are separate and
documented in the source; explicitly match the rules when comparing runs.

`npm run run:execution` executes the new native source in PineTS and writes
`.dmk-results/pine-execution.json`. The independent JS selector/auditor and
native Pine checks serve different purposes; no automatic claim of equivalent
TradingView fills is made. See [execution-audit.md](execution-audit.md) for the
precise structural definitions and historical-record limits.
