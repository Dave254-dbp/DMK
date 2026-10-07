# DMK

DMK has a local PineTS workflow and a structural execution audit.
[DMK-execution.pine](DMK-execution.pine) adds sweep → confirmed MSS → FVG retest
entries, structural stops, fixed liquidity targets and separate outcomes.
[DMK.pine](DMK.pine) preserves the original six-tier alignment indicator so
previous A+ labels remain reproducible. A+ alignment is not a winning trade.

For Cowork, select branch `cowork/dmk-execution-v0.4` and read
[COWORK-HANDOFF.md](COWORK-HANDOFF.md). It includes portable setup commands,
current execution rules and the remaining historical-data validation work.

## Run here

Use Node.js 22 or newer from the existing `/workspace/DMK` checkout:

```sh
npm ci --cache /workspace/.npm-cache --ignore-scripts --no-audit --no-fund
npm test
npm run run
npm run audit:structural
npm run run:execution
```

The default run executes the entire source in PineTS 0.11.0 on synthetic,
coherently aggregated candles. The latest 3,000 5m bars produced 35 A+ buys,
four bullish CHoCH warnings, four bearish CHoCH warnings, and no runtime warnings.
These are fixture results, not market quotes or trading returns.

Open `.dmk-results/chart.svg` for the price/signal chart. `summary.json` records
counts, inputs, and the source hash; `latest.json` contains candles and plots.
The structural JSON/HTML report retains all qualified orders and every old A+
label separately. Its default fixture has no strict structural orders; it does
not invent trades from the 35 alignment labels.

The execution version offers FVG midpoint/near-edge entry, an SL beyond the
sweep extreme plus a tick buffer, and nearest opposing PDH/PDL/swing liquidity
or PDH/PDL only. 1R/2R/3R are optional reference lines. B setups use the same
execution requirements and have separate results; B is disabled by default.
See [execution rules and audit](docs/execution-audit.md) for assumptions, report
fields, ambiguity handling and using actual OANDA candle history.

## Preserved alignment indicator improvements

- Every retained pivot is checked for a break; a newer unbroken pivot no longer
  hides an older crossed level. The newest crossed level remains primary.
- With opposing tiers blocked, Monthly and Weekly must be available. The
  `Allow opposing Monthly / Weekly tier` override keeps its permissive behavior.
- Daily, 4H, 1H, and Execution must agree. Six aligned tiers give A+, five give
  A, four give B; the default minimum of five excludes B.
- Execution BOS/MSS signals require a closed bar. CHoCH warns first; a later
  opposing break confirms reversal. Pending tiers still count their stored trend.

Local tests cover the native indicator, structural selection, future retests,
failed and unfilled orders, and uncertain candle event order. The user's
screenshot shows the execution indicator loaded in TradingView; independent
compiler verification, replay/reload comparison and live-alert checks remain
pending. For custom OHLCV
and TradingView checks, see the
[development workflow](docs/development.md); retained design choices are in the
[logic review](docs/logic-review.md).
