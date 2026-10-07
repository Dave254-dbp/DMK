# Structural execution and historical audit

The original `DMK.pine` remains available so every previous A+ label can be
reproduced. Its grade means six stored timeframe trends agree; it does not
establish a sweep, FVG retest, entry, stop, target, or profitable trade.
`DMK-execution.pine` is the structural execution version. Use one version at a
time in TradingView to avoid confusing alignment labels with execution records.

## Explicit execution rules

The following are repeatable defaults, rather than a claim to recognize every
discretionary POI. Midpoint/near-edge entry and the liquidity-target policy are
configurable. Order blocks and other POIs require an additional definition.

1. A confirmed candle sweeps an available execution swing or native previous-day
   high/low and closes back across it. The reference and opposite execution swing
   must be known before that candle. A candle sweeping both directions is excluded.
2. On a later confirmed candle, price closes through the opposite swing recorded
   at the sweep. This is the structural MSS used by the execution model; the
   original indicator's second opposing break is recorded separately.
3. A three-candle FVG confirms on or after that MSS. A bullish gap is between
   `high[2]` and `low`; a bearish gap is between `high` and `low[2]`. All three
   candles must be available before the gap can arm an order.
4. The entry level is the gap midpoint by default, or its near edge if selected.
   A new order can trigger only on a subsequent bar retesting that exact level.
   Stop is beyond the frozen sweep extreme, with a configurable tick buffer.
   With known instrument precision, entry and SL round to the nearest valid
   tick; the rounded entry must remain inside the gap and risk must be positive.
5. The fixed target is opposing liquidity known and still untaken at arming.
   Default selection is the nearest eligible native PDH/PDL or confirmed execution
   swing. A PDH-for-long/PDL-for-short-only policy is also available. No target
   means no qualified order. Target R:R is calculated from these frozen levels;
   optional 1R/2R/3R lines are references, rather than replacement targets.

Daily, 4H, 1H, and execution trends must agree. Six aligned tiers give A+, five
give A, and four give B. The score states agreement out of six; it is not a
calibrated probability of success. Optional-tier conflicts and pending CHoCH
states remain visible in evidence. B keeps the same structural execution rules
and is disabled by default; enable it explicitly and compare its outcomes
separately. No lower win-rate assumption or position-size recommendation is
inferred from the grade.

An unfilled order expires after 24 future chart bars by default. Already active
trades retain their frozen structural target and stop. Breakeven management is
disabled unless an explicit rule is selected. All overlapping setups are audited
independently; the report is not a portfolio backtest.

## Run the audit here

```sh
npm run audit:catalog
npm run audit:structural
npm run run:execution
```

Without `--data`, every command uses clearly labeled simulated candles. These
results check the software and do not answer whether a particular EUR/USD trade
won. The catalog preserves every original A+ signal. The structural audit
selects orders, evaluates their future retests/outcomes, and writes all records
to `.dmk-results/structural-audit.json` and an interactive HTML report beside it.
The native execution command runs the new Pine source in PineTS and saves its
plots, tables, drawings, source hash, and warnings.

For an actual chart audit:

```sh
npm run audit:structural -- --data oanda-eurusd.json --timeframe 15 --rules rules.json
```

Supply the same symbol/feed, chart timeframe, inputs, and period as the chart,
with sufficient earlier history to initialize all six timeframe states. The
bundle contract is documented in [development.md](development.md). Without an
explicit `--bars` limit, all supplied execution candles are audited. Native `D`
candles define previous-day liquidity; the runner does not substitute a UTC or
computer-local calendar day for OANDA's native daily session. Instrument tick,
pip and session metadata should match the data.

`npm run audit:setups -- --setups qualified.json --candles candles.json` can also
evaluate externally supplied qualified records. That evaluator validates frozen
level timestamps and risk direction, but does not certify the supplied structural
evidence or select liquidity itself.

## What the records mean

Every structural record retains direction, grade/score, qualification evidence,
gap zone, arming time, entry/SL/target, structural R:R, risk distance, available
instrument units, retest time, outcome, target reached and maximum favorable R.
All original A+ labels have a separate legacy audit entry. A label lacking a
structural sequence is not counted as a losing executed trade. Qualification
and trade outcome are distinct populations and fields.

Outcomes are WIN, LOSS, BREAKEVEN, INVALIDATED before entry, NOT TRIGGERED, OPEN,
or AMBIGUOUS. WIN requires an established entry followed by the fixed liquidity
target; taking the target before entry invalidates the pending order. NOT
TRIGGERED includes expiry and no established retest before supplied history ends;
the evidence distinguishes them. OPEN means a triggered trade has no terminal
exit in the available history. Summary totals retain every record and separate
A+, A and B.

An OHLC candle supplies an interval, rather than an exact intrabar timestamp.
Only a retest at the opening price has an exact opening timestamp. If retest,
invalidation, stop or target share a candle and their order is unknown, the model
reports ambiguity. Maximum R is exact only when candle evidence establishes it;
otherwise it is a lower/upper bound, capped at the fixed target. Lower-timeframe
or tick history is needed to resolve remaining uncertainty. This model does
not assume spreads, slippage, fees, executable fills, partial exits, or account
risk sizing. Risk percentage means SL distance divided by entry quote.

TradingView limits drawings and script resources. The Pine display keeps a
bounded visual history while its totals retain completed setups; excessive
concurrent orders stop the run with an explicit error. The local JSON/HTML audit
retains every supplied historical record. TradingView compilation and realtime
behavior require validation in its official editor; PineTS is an independent
runtime.
