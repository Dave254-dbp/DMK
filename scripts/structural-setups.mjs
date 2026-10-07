/** Causal structural qualification, kept separate from the original A+ labels.
 * This module detects setups, not executable fills or trade outcomes. Run its
 * frozen `setups` through setup-audit.mjs to evaluate subsequent OHLC evidence.
 */

const TIERS = ['M', 'W', 'D', '4H', '1H', 'E'];
const CORE = ['D', '4H', '1H', 'E'];
const eventNames = { 1: 'BOS', 2: 'CHoCH', 3: 'Custom MSS' };
const clone = value => structuredClone(value);
const directionName = direction => direction === 1 ? 'long' : 'short';
const finite = value => Number.isFinite(value) ? value : null;

function validateHistory(rows, name) {
  if (!Array.isArray(rows)) throw new TypeError(`${name} must be an array`);
  let previous = null;
  for (const [index, row] of rows.entries()) {
    if (!row || !['openTime', 'closeTime', 'open', 'high', 'low', 'close'].every(key => Number.isFinite(row[key]))
        || !Number.isSafeInteger(row.openTime) || !Number.isSafeInteger(row.closeTime)
        || row.openTime < 0 || row.closeTime <= row.openTime
        || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)
        || row.high < row.low || (previous && row.openTime < previous.closeTime)) {
      throw new RangeError(`Invalid or unordered ${name} candle ${index}`);
    }
    previous = row;
  }
}

function settingsFor(metadata, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const allowed = new Set(['entryMode', 'targetMode', 'tickSize', 'pipSize', 'stopBufferTicks', 'bufferTicks',
    'expiryBars', 'sequenceExpiryBars', 'includeB', 'allowOpposingOptional', 'dailyCandles', 'dailyHistory',
    'includeRReferences', 'breakevenAfterR']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown structural rule: ${key}`);
  }
  const entryMode = options.entryMode ?? 'midpoint';
  const targetMode = options.targetMode ?? 'nearest-liquidity';
  if (!['midpoint', 'near-edge'].includes(entryMode)) throw new RangeError('entryMode must be midpoint or near-edge');
  if (!['nearest-liquidity', 'pdh-pdl-only'].includes(targetMode)) throw new RangeError('targetMode must be nearest-liquidity or pdh-pdl-only');
  const tickSize = (Object.hasOwn(options, 'tickSize') ? options.tickSize : metadata.symbolInfo?.mintick) ?? null;
  const pipSize = (Object.hasOwn(options, 'pipSize') ? options.pipSize : metadata.symbolInfo?.pipSize) ?? null;
  for (const [key, value] of Object.entries({ tickSize, pipSize })) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) throw new RangeError(`${key} must be a positive increment`);
  }
  const stopBufferTicks = options.stopBufferTicks ?? options.bufferTicks ?? (tickSize == null ? 0 : 1);
  if (!Number.isFinite(stopBufferTicks) || stopBufferTicks < 0) throw new RangeError('stopBufferTicks must be nonnegative');
  if (stopBufferTicks > 0 && tickSize == null) throw new RangeError('tickSize is required for a nonzero stopBufferTicks');
  const expiryBars = options.expiryBars ?? 24;
  const sequenceExpiryBars = options.sequenceExpiryBars ?? 24;
  for (const [key, value] of Object.entries({ expiryBars, sequenceExpiryBars })) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${key} must be a positive integer`);
  }
  for (const key of ['includeB', 'allowOpposingOptional', 'includeRReferences']) {
    if (options[key] != null && typeof options[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  }
  if (options.breakevenAfterR != null && (!Number.isFinite(options.breakevenAfterR) || options.breakevenAfterR <= 0)) {
    throw new RangeError('breakevenAfterR must be a positive R threshold');
  }
  return { entryMode, targetMode, tickSize, pipSize, stopBufferTicks, expiryBars, sequenceExpiryBars,
    includeB: options.includeB ?? false, allowOpposingOptional: options.allowOpposingOptional ?? false };
}

function quotedPrice(price, tickSize) {
  if (tickSize == null) return price;
  const scaled = price / tickSize;
  // Avoid a binary representation of an exact half-tick rounding downward.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2;
  return Number((Math.round(scaled + tolerance) * tickSize).toPrecision(15));
}

function plannedStop(sequence, direction, settings) {
  return quotedPrice(sequence.sweep.extreme - direction * settings.stopBufferTicks * (settings.tickSize ?? 0), settings.tickSize);
}

function qualification(tiers, direction, settings) {
  const reasonCodes = [];
  const values = Object.fromEntries(TIERS.map(tier => [tier, tiers[tier].trend]));
  const available = TIERS.every(tier => values[tier] != null);
  const coreAligned = CORE.every(tier => values[tier] === direction);
  const aligned = TIERS.filter(tier => values[tier] === direction).length;
  const grade = aligned === 6 ? 'A+' : aligned === 5 ? 'A' : aligned === 4 ? 'B' : null;
  if (!available) reasonCodes.push('TIERS_NOT_READY');
  if (!coreAligned) reasonCodes.push('CORE_TIERS_NOT_ALIGNED');
  if (!settings.allowOpposingOptional && ['M', 'W'].some(tier => values[tier] === -direction)) reasonCodes.push('OPPOSING_OPTIONAL_TIER');
  if (grade === 'B' && !settings.includeB) reasonCodes.push('B_DISABLED');
  if (grade == null) reasonCodes.push('INSUFFICIENT_ALIGNMENT');
  return { qualified: reasonCodes.length === 0, grade, aligned, reasonCodes, tierValues: clone(tiers) };
}

function publicLiquidity(level) {
  return { id: level.id, name: level.name, price: level.price, kind: level.kind,
    side: level.side, knownAt: level.knownAt, sourceBarOpen: level.sourceBarOpen,
    confirmationBarOpen: level.confirmationBarOpen ?? null,
    nativeDailyAvailableAt: level.nativeDailyAvailableAt ?? null };
}

/**
 * result is runIndicator({auditContext:true}) output. Native daily OHLC must be
 * supplied in options.dailyCandles (or result.dailyCandles/nativeDailyCandles).
 * PDH/PDL become available at the NEXT ACTUAL native daily candle's open; the
 * detector never synthesizes provider sessions from UTC calendar dates.
 *
 * FVG: geometric three-candle imbalance, confirmed on/after a post-sweep MSS.
 * MSS: later confirmed close through the opposite pre-sweep confirmed pivot;
 * this structural definition is distinct from v0.3's two-break Custom MSS.
 * Stops use the frozen sweep extreme plus the selected instrument tick buffer.
 * All setups are independent shadow opportunities; no account/pyramiding rule.
 */
export function detectStructuralSetups({ ctx, candles, metadata = {}, dailyCandles: resultDaily,
  nativeDailyCandles } = {}, options = {}) {
  validateHistory(candles, 'chart');
  if (!ctx?.plots) throw new TypeError('auditContext plots are required');
  const settings = settingsFor(metadata, options);
  const daily = options.dailyCandles ?? options.dailyHistory ?? resultDaily ?? nativeDailyCandles ?? [];
  validateHistory(daily, 'native daily');
  const observe = (name, index) => finite(ctx.plots[`Audit ${name}`]?.data[index]?.value);
  if (candles.length && !TIERS.every(tier => ctx.plots[`Audit Trend ${tier}`])) {
    throw new TypeError('Run the indicator with auditContext:true to expose all six tier trends');
  }
  const hasConfirmedPivots = !!ctx.plots['Audit Confirmed pivot high'] && !!ctx.plots['Audit Confirmed pivot low'];
  const configuredSwingBars = metadata.inputs?.['Swing bars each side'] ?? 5;
  const pivotBars = Number.isInteger(configuredSwingBars) && configuredSwingBars > 0 ? configuredSwingBars : null;
  const diagnostics = [];
  if (!daily.length) diagnostics.push('Native daily history is missing: PDH/PDL references and targets are unavailable; execution swings can still qualify nearest-liquidity setups.');
  if (!hasConfirmedPivots) diagnostics.push('Confirmed pivot plots are missing: only newly observed latest protected pivots are tracked, so the execution liquidity pool can be incomplete.');
  if (settings.tickSize == null) diagnostics.push('Instrument tick size is unknown: the stop buffer is zero and riskPoints cannot be calculated.');
  const dailyEvents = daily.slice(0, -1).map((row, index) => ({ row, knownAt: daily[index + 1].openTime }));
  const pool = [];
  const setups = [];
  const candidates = [];
  const active = new Map();
  const latestSequence = new Map();
  const legacyRecords = [];
  const structuralRejections = [];
  let dailyIndex = 0, serial = 0;
  const lastProtected = { high: null, low: null };
  const addLevel = ({ side, price, knownAt, sourceBarOpen, confirmationBarOpen = null,
    kind = 'execution-swing', name, coverageKnown = true }) => {
    const level = { id: `liquidity-${++serial}`, side, price, knownAt, sourceBarOpen, kind,
      confirmationBarOpen, name: name ?? `Confirmed Execution swing ${side}`, coverageKnown,
      consumed: false, closeBroken: false, currentDay: true };
    pool.push(level);
    return level;
  };

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    while (dailyIndex < dailyEvents.length && dailyEvents[dailyIndex].knownAt <= candle.openTime) {
      const { row, knownAt } = dailyEvents[dailyIndex++];
      for (const level of pool) if (level.kind === 'native-previous-day') level.currentDay = false;
      // Before the chart's first candle, earlier intraday consumption is unknown.
      const coverageKnown = knownAt >= candles[0].openTime;
      if (!coverageKnown && !diagnostics.some(note => note.startsWith('Initial previous-day'))) {
        diagnostics.push('Initial previous-day liquidity consumption is unknown because chart history starts after the native session open; those day levels are excluded until the next covered native session.');
      }
      for (const [side, name, price] of [['high', 'PDH', row.high], ['low', 'PDL', row.low]]) {
        const level = addLevel({ side, price, knownAt, sourceBarOpen: row.openTime,
          kind: 'native-previous-day', name, coverageKnown });
        level.nativeDailyAvailableAt = knownAt;
      }
    }
    const tiers = Object.fromEntries(TIERS.map(tier => [tier, { trend: observe(`Trend ${tier}`, index),
      pendingUp: observe(`Pending up ${tier}`, index) === 1,
      pendingDown: observe(`Pending down ${tier}`, index) === 1 }]));
    // Snapshot before this candle consumes liquidity or confirms new pivots.
    const previouslyKnown = pool.filter(level => level.knownAt <= candle.openTime);
    const sweepable = previouslyKnown.filter(level => !level.consumed && level.coverageKnown
      && (level.kind !== 'native-previous-day' || level.currentDay));
    const sweeps = [];
    const sweptDirections = [];
    for (const direction of [1, -1]) {
      const side = direction === 1 ? 'low' : 'high';
      const reclaimed = sweepable.filter(level => level.side === side
        && (direction === 1 ? candle.low < level.price && candle.close > level.price
          : candle.high > level.price && candle.close < level.price));
      if (!reclaimed.length) continue;
      sweptDirections.push(direction);
      const opposite = previouslyKnown.filter(level => level.kind === 'execution-swing'
        && level.side !== side && !level.closeBroken
        && (direction === 1 ? level.price > candle.close : level.price < candle.close)).at(-1);
      if (!opposite) continue;
      // One sequence per direction per candle, retaining all swept references.
      const reference = [...reclaimed].sort((a, b) => b.knownAt - a.knownAt)[0];
      const sequence = { id: `sequence-${direction}-${candle.openTime}`, direction: directionName(direction),
        state: 'WAIT_MSS', sweepBarIndex: index,
        sweep: { barOpen: candle.openTime, confirmedAt: candle.closeTime,
          reference: publicLiquidity(reference), references: reclaimed.map(publicLiquidity),
          extreme: direction === 1 ? candle.low : candle.high,
          rule: 'Strict wick penetration and close reclaim of previously known, unconsumed liquidity' },
        mssReference: publicLiquidity(opposite), mss: null, fvg: null, setupId: null,
        reasonCodes: ['MSS_NOT_CONFIRMED'], qualificationAttempts: [] };
      sweeps.push([direction, sequence]);
    }
    const barReasons = [];
    if (sweptDirections.length === 2) {
      // OHLC cannot establish which opposing sweep preceded the other.
      sweeps.length = 0;
      barReasons.push('DUAL_SWEEP_AMBIGUOUS');
      structuralRejections.push({ barOpen: candle.openTime, confirmedAt: candle.closeTime,
        reasonCodes: [...barReasons] });
    }

    // Wick consumption applies to targets as well as sweep sources, including
    // the candle that will arm an order. Close-break state is separate for MSS.
    for (const level of previouslyKnown) {
      if (level.side === 'high' ? candle.high >= level.price : candle.low <= level.price) level.consumed = true;
      if (level.side === 'high' ? candle.close > level.price : candle.close < level.price) level.closeBroken = true;
    }
    for (const [direction, sequence] of active) {
      if (index - sequence.sweepBarIndex > settings.sequenceExpiryBars) {
        sequence.state = 'EXPIRED'; sequence.terminalAt = candle.closeTime;
        sequence.reasonCodes = ['STRUCTURAL_SEQUENCE_EXPIRED']; active.delete(direction);
      } else if (index > sequence.sweepBarIndex
          && (direction === 1 ? candle.low <= plannedStop(sequence, direction, settings)
            : candle.high >= plannedStop(sequence, direction, settings))) {
        sequence.state = 'INVALIDATED'; sequence.terminalAt = candle.closeTime;
        sequence.reasonCodes = ['PLANNED_STRUCTURAL_STOP_TAKEN_BEFORE_ARMING']; active.delete(direction);
      } else if (!sequence.mss && index > sequence.sweepBarIndex
          && (direction === 1 ? candle.close > sequence.mssReference.price : candle.close < sequence.mssReference.price)) {
        sequence.mss = { barOpen: candle.openTime, confirmedAt: candle.closeTime,
          level: sequence.mssReference,
          rule: 'Later confirmed close through the opposite confirmed Execution pivot frozen at the sweep' };
        sequence.state = 'WAIT_FVG'; sequence.reasonCodes = ['CONFIRMED_FVG_MISSING'];
      }
    }
    for (const [direction, sequence] of sweeps) {
      const prior = active.get(direction);
      if (prior) {
        prior.state = 'INVALIDATED'; prior.terminalAt = candle.closeTime;
        prior.reasonCodes = ['SUPERSEDED_BY_NEW_SWEEP'];
      }
      active.set(direction, sequence); latestSequence.set(direction, sequence); candidates.push(sequence);
    }

    for (const side of ['high', 'low']) {
      const value = observe(hasConfirmedPivots ? `Confirmed pivot ${side}` : `Protected ${side}`, index);
      if (value != null && (hasConfirmedPivots || value !== lastProtected[side])) {
        const sourceBarOpen = hasConfirmedPivots && pivotBars != null ? candles[index - pivotBars]?.openTime ?? null : null;
        const level = addLevel({ side, price: value, knownAt: candle.closeTime,
          sourceBarOpen, confirmationBarOpen: candle.openTime });
        // A newly confirmed pivot must not conceal a formation-bar touch.
        level.consumed = side === 'high' ? candle.high >= value : candle.low <= value;
        level.closeBroken = side === 'high' ? candle.close > value : candle.close < value;
      }
      if (!hasConfirmedPivots) lastProtected[side] = value;
    }

    for (const [direction, sequence] of active) {
      if (!sequence.mss) continue;
      if (sequence.fvg && (direction === 1 ? candle.low <= sequence.fvg.high : candle.high >= sequence.fvg.low)
          && candle.closeTime > sequence.fvg.confirmedAt) {
        sequence.fvg = null; sequence.reasonCodes = ['FVG_MITIGATED_BEFORE_ARMING'];
      }
      if (index >= 2 && candle.closeTime >= sequence.mss.confirmedAt && index > sequence.sweepBarIndex) {
        const earlier = candles[index - 2];
        const isGap = direction === 1 ? candle.low > earlier.high : candle.high < earlier.low;
        if (isGap) sequence.fvg = { direction: directionName(direction),
          low: direction === 1 ? earlier.high : candle.high,
          high: direction === 1 ? candle.low : earlier.low,
          firstBarOpen: earlier.openTime, confirmationBarOpen: candle.openTime,
          confirmedAt: candle.closeTime, rule: 'Confirmed geometric three-candle FVG; no order-block substitute' };
      }
      if (!sequence.fvg) continue;
      const alignment = qualification(tiers, direction, settings);
      const rawEntry = settings.entryMode === 'midpoint' ? (sequence.fvg.low + sequence.fvg.high) / 2
        : direction === 1 ? sequence.fvg.high : sequence.fvg.low;
      const entry = quotedPrice(rawEntry, settings.tickSize);
      const stop = plannedStop(sequence, direction, settings);
      const eligible = pool.filter(level => !level.consumed && level.coverageKnown
        && level.knownAt <= candle.closeTime && level.side === (direction === 1 ? 'high' : 'low')
        && (level.kind !== 'native-previous-day' || level.currentDay)
        && (settings.targetMode !== 'pdh-pdl-only' || level.kind === 'native-previous-day')
        && direction * (level.price - entry) > 0);
      eligible.sort((a, b) => direction * (a.price - b.price) || b.knownAt - a.knownAt);
      const target = eligible[0];
      const reasons = [...alignment.reasonCodes];
      if (!(entry > 0) || entry < sequence.fvg.low || entry > sequence.fvg.high) reasons.push('ENTRY_OUTSIDE_FVG_AFTER_ROUNDING');
      if (!(direction * (entry - stop) > 0) || (settings.tickSize != null && direction * (entry - stop) < settings.tickSize - settings.tickSize * 1e-9)) reasons.push('INVALID_STRUCTURAL_RISK');
      if (settings.stopBufferTicks > 0 && !(direction * (sequence.sweep.extreme - stop) > 0)) reasons.push('STOP_NOT_BEYOND_SWEEP_EXTREME');
      if (!target) reasons.push(settings.targetMode === 'pdh-pdl-only' && !daily.length
        ? 'NATIVE_DAILY_HISTORY_MISSING' : 'NO_UNCONSUMED_OPPOSING_LIQUIDITY_TARGET');
      sequence.reasonCodes = reasons;
      sequence.qualificationAttempts.push({ confirmedAt: candle.closeTime, grade: alignment.grade,
        qualified: reasons.length === 0, reasonCodes: [...reasons],
        observedEntry: entry, observedStop: stop, observedTarget: target ? publicLiquidity(target) : null });
      if (reasons.length) continue;
      const id = `${metadata.symbol ?? 'CUSTOM:DMK'}:strict:${candle.closeTime}:${direction}`;
      const setup = { id, symbol: metadata.symbol ?? null, grade: alignment.grade,
        direction: directionName(direction), entry, stop,
        knownAt: candle.closeTime, entryKnownAt: sequence.fvg.confirmedAt,
        stopKnownAt: sequence.sweep.confirmedAt,
        expiresAt: null, expiresAfterBars: settings.expiryBars,
        tickSize: settings.tickSize, pipSize: settings.pipSize,
        target: { ...publicLiquidity(target), selection: settings.targetMode },
        zone: clone(sequence.fvg),
        score: { alignedTiers: alignment.aligned, maximum: 6,
          sequenceEvidence: { sweep: true, mss: true, confirmedFVG: true },
          definition: 'Tier agreement out of six; separate structural evidence flags; not a probability or performance rating' },
        qualificationEvidence: { qualificationConfirmedAt: candle.closeTime, grade: alignment.grade,
          alignedTiers: alignment.aligned, tierValues: alignment.tierValues,
          sweep: clone(sequence.sweep), mss: clone(sequence.mss), fvg: clone(sequence.fvg),
          targetSelection: { chosen: publicLiquidity(target), rule: settings.targetMode,
            eligibleAtArming: eligible.map(publicLiquidity), wickConsumptionIncludesArmingBar: true },
          selectedRules: clone(settings),
          priceRounding: settings.tickSize == null ? 'Unknown tick size: no instrument price rounding or stop buffer'
            : 'Entry and buffered planned stop rounded to nearest instrument tick; entry must remain inside FVG and a nonzero buffered stop must remain beyond the sweep extreme',
          entryActivation: 'Only candles opening at or after this confirmed arming close may establish a retest',
          poiDefinition: 'Geometric FVG only; no independently specified order-block or POI detector',
          mssDefinition: 'Post-sweep confirmed opposite-pivot close break; separate from DMK v0.3 Custom MSS',
          pendingCHoCH: 'Tier trend values retain legacy pending-CHoCH alignment semantics' } };
      setups.push(setup); sequence.state = 'ARMED'; sequence.setupId = id;
      sequence.armedAt = candle.closeTime; sequence.reasonCodes = [];
      active.delete(direction);
    }

    for (const [name, direction] of [['A+ Buy', 1], ['A+ Sell', -1]]) {
      const value = ctx.plots[name]?.data[index]?.value;
      if (value !== true && value !== 1) continue;
      const sequence = latestSequence.get(direction);
      const linked = sequence?.setupId ? setups.findLast(setup => setup.id === sequence.setupId) : null;
      const newAPlus = linked?.knownAt === candle.closeTime && linked.grade === 'A+';
      const reasonCodes = [...(sequence ? sequence.reasonCodes : ['PRIOR_CONFIRMED_SWEEP_MISSING']), ...barReasons];
      if (linked && !newAPlus) reasonCodes.push('LEGACY_LABEL_IS_NOT_A_NEW_STRUCTURAL_A_PLUS_ORDER');
      if (linked && linked.grade !== 'A+') reasonCodes.push('LINKED_SETUP_HAS_DIFFERENT_GRADE');
      const qualificationEvidence = sequence ? {
        sweep: clone(sequence.sweep), mss: clone(sequence.mss), fvg: clone(sequence.fvg),
        sequenceStateAtSignal: sequence.state, sequenceId: sequence.id } : null;
      legacyRecords.push({ id: `${metadata.symbol ?? 'CUSTOM:DMK'}:${candle.openTime}:${direction}`,
        grade: 'Legacy A+', direction: directionName(direction), signalBarOpen: candle.openTime,
        signalConfirmedAt: candle.closeTime, tiers: clone(tiers),
        executionEvent: eventNames[observe('Event E', index)] ?? null,
        observations: { structuralSequenceAtSignal: clone(qualificationEvidence) },
        executionQualification: { qualified: !!newAPlus, linkedSetupId: linked?.id ?? null,
          linkKind: linked ? (newAPlus ? 'ARMED_ON_SIGNAL' : 'PRIOR_STRUCTURAL_SEQUENCE') : null,
          reasonCodes }, qualificationEvidence,
        entry: null, stop: null, target: null, outcome: null,
        reason: newAPlus ? 'A new strict A+ setup armed at this signal; trade outcome remains separate.'
          : linked ? 'This label references an earlier structural opportunity; it is not another inferred entry or win.'
            : 'This alignment label has no fully qualified structural entry at its confirmation.' });
    }
  }
  const counts = { strictSetups: setups.length,
    byGrade: Object.fromEntries(['A+', 'A', 'B'].map(grade => [grade, setups.filter(setup => setup.grade === grade).length])),
    legacyAPlus: legacyRecords.length,
    legacyNewStrictAPlus: legacyRecords.filter(record => record.executionQualification.qualified).length,
    tradeOutcomesDefined: 0 };
  const assumptions = [
    'Qualification is evaluated only on completed candles; all frozen price levels use evidence available at arming.',
    'MSS is the later opposite-pivot close break after a sweep, not the legacy second-break Custom MSS event.',
    'FVG is a three-candle geometric gap confirmed on/after MSS; retests cannot precede arming.',
    'Each new sweep can arm at most one structural order; overlapping opportunities are independent shadow setups.',
    'Sequence expiry counts candles after the sweep; order expiry counts eligible future candles after arming, not wall-clock hours.',
    'Legacy A+ labels and new strict structural setups are different populations; neither qualification nor linkage implies a trade outcome.',
    'Native previous-day levels become available at the next supplied actual daily open; no UTC session is inferred.',
    'Known-tick entry and planned stop are rounded to nearest tick; a nonzero buffered stop must remain beyond the sweep extreme and the entry inside its FVG.',
    'No displacement threshold, order-block proxy, fees, spread, slippage or exact intrabar fill timestamps are inferred.',
  ];
  return { metadata: { ...clone(metadata), purpose: 'Causal structural setup detection; no trade-performance claim', assumptions },
    settings, setups, counts, diagnostics, structuralCandidates: clone(candidates), structuralRejections,
    legacyAudit: { metadata: { ...clone(metadata), purpose: 'Every original A+ alignment label, linked only to causal structural evidence' },
      counts: { legacyAPlus: counts.legacyAPlus, newStrictAPlus: counts.legacyNewStrictAPlus, tradeOutcomesDefined: 0 },
      records: legacyRecords } };
}

export const buildStructuralSetups = detectStructuralSetups;
