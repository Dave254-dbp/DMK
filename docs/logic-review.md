# DMK v0.3 logic review

## Implemented fixes

**All crossed levels are consumed.** The old loops stopped at a newer unbroken
pivot. With highs `[100, 110]`, close `105`, and buffer `1`, they missed the
older crossed `100`; the analogous lows `[100, 90]` at close `95` also failed.
The new backward scans remove every crossed level, preserve retained order,
and keep the newest crossed level primary. Each side visits at most 100 entries.
Thresholds remain strict: equality to a buffered level does not break it.

**Missing optional tiers are blocked by default.** Monthly and Weekly must both
be available when opposing tiers are disabled. An unaligned available tier must
be neutral; `na` is Waiting, rather than neutral. Enabling the opposing-tier
override retains the former permissive behavior, including missing optional tiers.
The four core tiers still must agree and satisfy the alignment minimum.

**The primary chart guard remains active.** It now follows the native-tier
requests and precedes signal calculations. This avoids PineTS re-evaluating the
chart-only restriction inside higher-tier expression prefixes. The condition
and error are unchanged; an integration test verifies 1H rejection.

The regression tests execute source-extracted native Pine blocks in PineTS.
The repaired v0.2 source fails nine relevant assertions; all 20 logic tests
pass on v0.3. Four full-source integration tests also pass. Signal results can
change because the two fixes change which breaks and alignment gates qualify.

## Retained design choices

- **Range means initialization.** Trend starts at zero and never returns to
  zero after its first directional classification. Sideways price action alone
  does not neutralize an established trend.
- **Pending CHoCH retains alignment.** `Bull / CH↓` still counts bullish.
  The first opposing event warns, the next confirms MSS, and an original-direction
  BOS clears pending status. There is no expiry; multiple breaks on one bar
  produce at most one event.
- **Higher tiers use completed native bars.** Returned values use `[1]` with
  `lookahead_on`. Execution signals/CHoCH markers require bar confirmation;
  the Execution dashboard can update intrabar. Local historical tests do not
  verify realtime rollback or TradingView repaint behavior.
- **Cooldown counts intervening bars.** A bar-100 signal with cooldown 4 permits
  the next signal no earlier than bar 105, in either direction. Blocked events
  are not deferred.
- **Location is a range-half proxy.** It defaults off, can qualify on the same
  bar as a touch, resets when a valid 4H range changes, and ages touches using
  chart-bar opening timestamps. Touch resolution depends on the chart timeframe.
- **Grades count agreement.** A+/A/B mean six/five/four tiers, respectively.
  Default minimum 5 excludes B. Retained pivot caps and available warm-up history
  affect state; grades are not performance estimates.

The full source runs locally on coherent synthetic multi-timeframe candles.
The user's screenshot shows the execution indicator loaded in TradingView.
Independent compiler verification, replay and live alerts remain pending; see the
[development workflow](development.md) for those checks.

## Structural execution revision

`DMK-execution.pine` is a separate v0.4 source with causal sweep/MSS/FVG
qualification, future retest entries, frozen structural SL/liquidity TP and
independent outcomes. Its evidence score is agreement out of six, accompanied
by sequence proofs, rather than a success estimate. The original v0.3 signals
remain reproducible and every original A+ label is cataloged separately.

The local selector/auditor uses native daily boundaries, tracks wick-consumed
liquidity separately from close-broken MSS references, rounds supplied instrument
ticks, and excludes unknown earlier consumption. Both versions preserve
completed higher-timeframe data and confirmed execution bars. See
[execution-audit.md](execution-audit.md) for the complete model and limits.
