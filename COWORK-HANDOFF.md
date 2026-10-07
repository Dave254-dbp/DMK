# DMK handoff to Cowork

Prepared 7 October 2026, Africa/Nairobi.

## Start here

Continue this project from GitHub repository `Dave254-dbp/DMK`, branch
`cowork/dmk-execution-v0.4`. Select that branch before opening files: `main`
still contains the initial README-only revision. The project folder is the
repository root, named `DMK`; this file and `DMK-execution.pine` are directly
inside it. In Codex cloud the same folder is `/workspace/DMK`. Cowork's own
checkout can be in a different local location.

The ZIP handoff is an alternative source snapshot with the same `DMK/`
project folder. The cloud "Configure setup instructions" panel only saves
Codex installation/start instructions; it does not upload source to GitHub.

The user wants a usable Pine indicator and an honest audit of A+ execution:
exact entry level and known timestamp/interval, structural SL, actual opposing
liquidity TP, risk distance and R:R, direction, score/evidence, outcomes,
maximum favorable R and target reached. Audit all supplied historical labels
and setups; keep qualification separate from trade outcome.

1. Read `README.md`, `docs/development.md`, `docs/execution-audit.md` and
   `docs/logic-review.md`.
2. From this folder, with Node.js 22 or newer, run:

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund
   npm test
   npm run audit:structural
   npm run run:execution
   ```

   PineTS is pinned to 0.11.0. The last full suite passed 144 tests, zero failed
   or skipped. On the Codex cloud machine, the tested installation uses
   `--cache /workspace/.npm-cache`; on a local machine use its normal npm cache.
3. Obtain the user's actual OANDA EUR/USD history, exact chart inputs and date
   range; reconcile native TradingView behavior with local records.
4. Perform TradingView replay/reload checks and validate alerts if browser
   access is available. Explain any external access or data still needed.

## Current Pine sources

`DMK-execution.pine` is v0.4, the version the user pasted into TradingView.
It uses these repeatable, configurable execution rules:

- Liquidity is a previously known, unconsumed execution swing or native PDH/PDL.
  A sweep requires wick penetration and a confirmed close reclaim.
- A later confirmed close through the opposite confirmed, close-unbroken
  execution swing frozen at the sweep establishes structural MSS.
- A geometric three-candle FVG confirms on/after MSS. Entry uses its midpoint
  by default, with near-edge entry configurable. It can trigger only on a
  subsequent reference-level retest, never on the FVG confirmation candle.
- Structural SL is beyond the frozen sweep extreme, plus one tick by default.
  Entry/SL round to instrument ticks. TP is frozen, known opposing liquidity:
  nearest eligible PDH/PDL/confirmed execution swing, or PDH/PDL only.
- Optional 1R/2R/3R lines are references. They do not replace the liquidity TP.
- Daily, 4H, 1H and Execution must agree. All six tiers must initialize.
  A+/A/B are six/five/four aligned tiers. B retains the same execution rules,
  is disabled by default, and has separate audit totals. Optional-tier
  conflicts require the explicit override.
- Sequence and pending-entry expiry independently default to 24 chart bars.
  Breakeven is disabled by default. If enabled, it uses a prior confirmed MFE
  lower bound and activates on the next bar.

Entry/SL/TP labels, compact outcome labels and full hover evidence are present.
Default drawings retain the latest 50 setups, configurable up to 80. Completed
totals retain all qualified setups in loaded chart history. Concurrent/catalog
capacity errors stop an incomplete run rather than silently discard setups.

`DMK.pine` is the preserved v0.3 alignment indicator. Its A+ labels mean six
stored trends agreed at signal confirmation, not a proven sweep/FVG entry or
successful trade. Audit this legacy population separately from strict orders.
Its custom second-opposing-break MSS differs from the structural MSS above.

## Existing audit tools

- `npm run audit:catalog`: preserves every legacy A+ label and causal observations.
- `npm run audit:structural`: selects strict setups, audits future retests,
  preserves all original A+ labels separately and exports JSON plus interactive
  HTML. With supplied data and no `--bars`, it processes all supplied execution
  candles. An explicit window is recorded in metadata.
- `npm run audit:setups`: evaluates externally supplied frozen qualified setups;
  the outcome evaluator does not certify their structural evidence.
- `npm run run:execution`: executes the native v0.4 Pine source in PineTS.
- `npm run run`: executes the preserved v0.3 source and creates its signal chart.

Generated outputs go to `.dmk-results/`. They are excluded from GitHub and the ZIP.
All default runs are simulated software fixtures: `SIMULATED:DMK`, 3,000 5m
bars, 35 legacy A+ buy labels and zero strict structural orders. Positive
long/short structural paths, failures, ambiguity, expiry and breakeven are
covered by controlled tests. Shared fixtures also compare native Pine and JS
frozen levels/outcomes. These are not EUR/USD performance results.

## What the user's TradingView screenshot establishes

The user supplied a screenshot of `DMK Execution` displayed on OANDA EUR/USD
15m with levels and dashboards. Its table reports:

| A+ result | Chart-displayed count |
|---|---:|
| Qualified | 2 |
| Entered | 1 |
| WIN | 1 |
| LOSS | 0 |
| INVALIDATED before entry | 1 |

The visible #2 A+ short is labeled INVALIDATED, with approximately entry
1.12506, SL 1.12615, PDL TP 1.12209 and R:R 2.72. The screenshot does not
establish its precise invalidation cause or exact retest event ordering.
These are chart-displayed modeled results, not an independently reproduced
historical audit or evidence of trading reliability. The screenshot supports
successful chart loading; formal replay/reload and live-alert checks remain
pending. The screenshot image itself is not included in the repository or ZIP.

## Data needed to complete the actual historical audit

Obtain coherent native OANDA EUR/USD candles for Execution (15m), 1H, 4H,
Daily, Weekly and Monthly, including sufficient earlier warm-up to reconstruct
stored trend/pivot states. Match symbol/feed, inputs, chart period, native
session boundaries, tick size and optional pip size. Do not substitute a UTC
calendar day for OANDA's native daily session. Lower-timeframe/tick data can
resolve otherwise ambiguous retest and exit ordering.

The bundle contract and rule keys are in `docs/development.md`.

```sh
npm run audit:structural -- --data oanda-eurusd.json --timeframe 15 --rules rules.json
npm run run:execution -- --data oanda-eurusd.json --timeframe 15 --inputs inputs.json
```

## Interpretation constraints

- Qualification is not success. An invalidated, unfilled setup is not an
  executed losing trade. Expired-unfilled and still-waiting-at-history-end
  are distinct report fields.
- Preserve completed higher-timeframe offsets and confirmed execution bars.
  Frozen entry/SL/TP evidence must use information available at arming.
- The model detects geometric FVGs. Discretionary POIs/order blocks and an
  additional displacement threshold have not been defined by the user.
- Intrabar times are intervals unless the opening-price event is known exactly.
  Unknown SL/TP/retest order remains AMBIGUOUS. MFE can be bounded rather than
  exact and ends at the fixed target.
- This is a reference-level retest model, not broker execution. A safe gap
  skipping the entry level does not invent an opening fill. Spread, slippage,
  fees, partial exits and portfolio/account sizing are not modeled.
- Risk percentage is stop distance divided by entry quote, not account capital
  at risk. Instrument points/pips require actual instrument metadata.
- Pending CHoCH keeps the preceding stored trend. A bullish 1H with a bearish
  CH warning can still block new shorts despite five bearish tiers.
- PineTS and controlled JS/native tests do not establish TradingView realtime
  behavior or actual broker fills. Continue validation using actual evidence.
