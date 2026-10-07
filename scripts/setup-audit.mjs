/**
 * Audit supplied, already-qualified setups against historical OHLC candles.
 * This module does not identify sweeps, MSS, FVGs, or liquidity pools.
 * Entry is a future reference-level retest, never an invented next-open fill.
 * Level touches assume the usual OHLC range model, not executable fills.
 * Fees, spread, slippage, partial exits, and intrabar tick paths are not modeled.
 */

const OUTCOMES = ['WIN', 'LOSS', 'BREAKEVEN', 'INVALIDATED', 'NOT_TRIGGERED', 'OPEN', 'AMBIGUOUS'];
const MODEL = 'OHLC reference-level retest; fixed supplied liquidity target; no execution-cost model';

function timestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be Unix milliseconds`);
  return value;
}

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function validateCandles(candles) {
  if (!Array.isArray(candles)) throw new TypeError('candles must be an array');
  const sorted = candles.map((candle, index) => {
    if (!candle || typeof candle !== 'object') throw new TypeError(`Invalid candle ${index}`);
    const row = { ...candle };
    timestamp(row.openTime, `candle ${index} openTime`);
    timestamp(row.closeTime, `candle ${index} closeTime`);
    for (const key of ['open', 'high', 'low', 'close']) finite(row[key], `candle ${index} ${key}`);
    if (row.closeTime <= row.openTime || row.high < Math.max(row.open, row.close)
        || row.low > Math.min(row.open, row.close) || row.high < row.low) {
      throw new RangeError(`Invalid OHLC or interval in candle ${index}`);
    }
    return row;
  }).sort((a, b) => a.openTime - b.openTime);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].openTime <= sorted[index - 1].openTime
        || sorted[index].openTime < sorted[index - 1].closeTime) {
      throw new RangeError('Candle intervals must be unique and non-overlapping');
    }
  }
  return sorted;
}

function validateSetup(setup, index, ids) {
  if (!setup || typeof setup !== 'object') throw new TypeError(`Invalid setup ${index}`);
  if (!['string', 'number'].includes(typeof setup.id) || String(setup.id).trim() === ''
      || (typeof setup.id === 'number' && !Number.isFinite(setup.id))) {
    throw new TypeError(`Setup ${index} requires an id`);
  }
  if (ids.has(String(setup.id))) throw new RangeError(`Duplicate setup id: ${setup.id}`);
  ids.add(String(setup.id));
  if (typeof setup.grade !== 'string' || !setup.grade.trim()) throw new TypeError(`Setup ${setup.id} requires a grade`);
  if (!['long', 'short'].includes(setup.direction)) throw new TypeError(`Invalid direction for ${setup.id}`);
  finite(setup.entry, `${setup.id} entry`);
  finite(setup.stop, `${setup.id} stop`);
  if (!(setup.entry > 0)) throw new RangeError(`Setup ${setup.id} requires a positive quoted entry for riskPercent`);
  for (const key of ['tickSize', 'pipSize']) {
    if (setup[key] != null && (!Number.isFinite(setup[key]) || setup[key] <= 0)) {
      throw new RangeError(`${key} for ${setup.id} must be a positive instrument price increment`);
    }
  }
  timestamp(setup.knownAt, `${setup.id} knownAt`);
  for (const key of ['entryKnownAt', 'stopKnownAt']) {
    if (setup[key] != null) {
      timestamp(setup[key], `${setup.id} ${key}`);
      if (setup[key] > setup.knownAt) throw new RangeError(`${key} for ${setup.id} follows qualification`);
    }
  }
  if (!setup.target || typeof setup.target.name !== 'string' || !setup.target.name.trim()) {
    throw new TypeError(`Setup ${setup.id} requires a named target`);
  }
  finite(setup.target.price, `${setup.id} target price`);
  timestamp(setup.target.knownAt, `${setup.id} target knownAt`);
  if (setup.target.knownAt > setup.knownAt) throw new RangeError(`Target for ${setup.id} was not known when the setup finalized`);
  const direction = setup.direction === 'long' ? 1 : -1;
  const risk = direction * (setup.entry - setup.stop);
  const reward = direction * (setup.target.price - setup.entry);
  if (!(risk > 0) || !(reward > 0) || !Number.isFinite(risk) || !Number.isFinite(reward)
      || !(reward / risk > 0) || !Number.isFinite(reward / risk)
      || !Number.isFinite(100 * (risk / setup.entry))
      || (setup.tickSize != null && !Number.isFinite(risk / setup.tickSize))
      || (setup.pipSize != null && !Number.isFinite(risk / setup.pipSize))) {
    throw new RangeError(`Invalid stop or target direction/risk for ${setup.id}`);
  }
  if (setup.expiresAt != null) {
    timestamp(setup.expiresAt, `${setup.id} expiresAt`);
    if (setup.expiresAt < setup.knownAt) throw new RangeError(`Expiry precedes qualification for ${setup.id}`);
  }
  if (setup.expiresAfterBars != null && (!Number.isSafeInteger(setup.expiresAfterBars) || setup.expiresAfterBars < 1)) {
    throw new RangeError(`expiresAfterBars for ${setup.id} must be a positive integer`);
  }
  if (setup.expiresAt != null && setup.expiresAfterBars != null) {
    throw new RangeError(`Setup ${setup.id} must select timestamp or chart-bar expiry, not both`);
  }
  return {
    id: setup.id, grade: setup.grade, direction: setup.direction,
    entry: setup.entry, stop: setup.stop, activeStop: setup.stop, target: { ...setup.target },
    knownAt: setup.knownAt, expiresAt: setup.expiresAt ?? null,
    expiresAfterBars: setup.expiresAfterBars ?? null, pendingEvaluatedBars: 0,
    entryKnownAt: setup.entryKnownAt ?? null, stopKnownAt: setup.stopKnownAt ?? null,
    score: structuredClone(setup.score ?? null),
    qualificationEvidence: structuredClone(setup.qualificationEvidence ?? null),
    zone: structuredClone(setup.zone ?? null), qualificationCertified: false,
    symbol: structuredClone(setup.symbol ?? null),
    tickSize: setup.tickSize ?? null, pipSize: setup.pipSize ?? null,
    risk, riskPriceDistance: risk,
    riskPoints: setup.tickSize == null ? null : risk / setup.tickSize,
    riskPips: setup.pipSize == null ? null : risk / setup.pipSize,
    riskPercent: 100 * (risk / setup.entry), targetRR: reward / risk,
    targetReached: null, rReferences: null,
    triggered: false, outcome: null,
    pendingAtEnd: false, untriggeredReason: null,
    entryTime: null, entryTimeFrom: null, entryTimeTo: null,
    outcomeTime: null, outcomeTimeFrom: null, outcomeTimeTo: null,
    exitReferencePrice: null, observedExitOpen: null,
    breakevenActivatedAt: null,
    maxRLower: null, maxRUpper: null, maxRExact: false,
    evaluatedBars: 0, sourceModel: MODEL, notes: [],
  };
}

function priceR(record, price) {
  return (record.direction === 'long' ? 1 : -1) * (price - record.entry) / record.risk;
}

function favorableR(record, bar) {
  return Math.max(0, priceR(record, record.direction === 'long' ? bar.high : bar.low));
}

function stopTouched(record, stop, bar) {
  return record.direction === 'long' ? bar.low <= stop : bar.high >= stop;
}

function targetTouched(record, bar) {
  return record.direction === 'long' ? bar.high >= record.target.price : bar.low <= record.target.price;
}

function setEntry(record, bar, exact) {
  record.triggered = true;
  record.entryTime = exact ? bar.openTime : null;
  record.entryTimeFrom = bar.openTime;
  record.entryTimeTo = exact ? bar.openTime : bar.closeTime;
  record.maxRLower = 0;
  record.maxRUpper = 0;
  record.maxRExact = true;
  if (!exact) record.notes.push('Entry time is bounded by the candle interval; OHLC does not supply an exact retest timestamp.');
}

function addMfe(record, lower, upper) {
  // Favorable wicks can precede an intrabar entry or follow an intrabar stop.
  // Cap the bound at the known fixed target: the audit ends at that threshold.
  record.maxRLower = Math.max(record.maxRLower ?? 0, Math.min(record.targetRR, Math.max(0, lower)));
  record.maxRUpper = Math.max(record.maxRUpper ?? 0, Math.min(record.targetRR, Math.max(0, upper)), record.maxRLower);
  record.maxRExact = record.triggered === true
    && Math.abs(record.maxRLower - record.maxRUpper) <= 1e-12;
}

function finish(record, outcome, bar, { exact = false, reference = null, note = null } = {}) {
  record.outcome = outcome;
  record.targetReached = outcome === 'WIN' ? record.target.name : null;
  record.outcomeTime = exact ? bar.openTime : null;
  record.outcomeTimeFrom = bar.openTime;
  record.outcomeTimeTo = exact ? bar.openTime : bar.closeTime;
  record.exitReferencePrice = reference;
  if (note) record.notes.push(note);
}

function expire(record, at = record.expiresAt) {
  record.outcome = 'NOT_TRIGGERED';
  record.untriggeredReason = 'EXPIRED';
  record.outcomeTime = at;
  record.outcomeTimeFrom = at;
  record.outcomeTimeTo = at;
  record.notes.push('The setup expired before a qualifying entry could be established. Expiry applies only while pending.');
}

function pendingAmbiguity(record, bar, { entryTouched, triggered, note }) {
  record.triggered = triggered;
  if (entryTouched) {
    record.entryTimeFrom = bar.openTime;
    record.entryTimeTo = bar.closeTime;
    addMfe(record, 0, favorableR(record, bar));
    if (triggered == null) record.maxRExact = false;
  }
  finish(record, 'AMBIGUOUS', bar, { note });
}

function processActive(record, bar, activeStop, intrabarEntry) {
  const direction = record.direction === 'long' ? 1 : -1;
  const stoppedAtOpen = direction * (bar.open - activeStop) <= 0;
  const targetAtOpen = direction * (bar.open - record.target.price) >= 0;
  const stopped = stopTouched(record, activeStop, bar);
  const target = targetTouched(record, bar);
  const stopOutcome = activeStop === record.entry ? 'BREAKEVEN' : 'LOSS';

  // An intrabar retest cannot use the pre-entry opening price as exit evidence.
  if (!intrabarEntry && stoppedAtOpen) {
    addMfe(record, 0, 0);
    record.observedExitOpen = bar.open;
    finish(record, stopOutcome, bar, { exact: true, reference: activeStop,
      note: 'The opening price crossed the active stop before any later candle movement. No fill price is inferred.' });
    return;
  }
  if (!intrabarEntry && targetAtOpen) {
    addMfe(record, record.targetRR, record.targetRR);
    record.observedExitOpen = bar.open;
    finish(record, 'WIN', bar, { exact: true, reference: record.target.price,
      note: 'The opening price crossed the fixed target first. MFE is capped at target RR; gap price improvement is not modeled.' });
    return;
  }

  const knownAfterEntry = intrabarEntry ? Math.max(0, priceR(record, bar.close)) : Math.max(0, priceR(record, bar.open));
  const favorable = favorableR(record, bar);
  if (stopped && target) {
    addMfe(record, intrabarEntry ? 0 : knownAfterEntry, record.targetRR);
    finish(record, 'AMBIGUOUS', bar, { note: 'SL and the fixed liquidity target occur inside the same candle; OHLC cannot establish their order.' });
  } else if (target) {
    addMfe(record, record.targetRR, record.targetRR);
    finish(record, 'WIN', bar, { reference: record.target.price });
  } else if (stopped) {
    addMfe(record, intrabarEntry ? 0 : knownAfterEntry, favorable);
    finish(record, stopOutcome, bar, { reference: activeStop,
      note: 'The favorable wick may follow the stop; pre-exit MFE is reported as bounds.' });
  } else {
    // With an already-active entry, the whole nonterminal range belongs to it.
    addMfe(record, intrabarEntry ? knownAfterEntry : favorable, favorable);
  }
}

function auditRecord(record, candles, options) {
  let activeStop = record.stop;
  let lastPendingClose = null;
  for (const bar of candles) {
    // A candle straddling qualification is excluded in full, without hindsight.
    if (bar.openTime < record.knownAt) continue;
    if (record.outcome) break;
    record.evaluatedBars++;

    if (!record.triggered) {
      if (record.expiresAfterBars != null && record.pendingEvaluatedBars >= record.expiresAfterBars) {
        expire(record, lastPendingClose);
        break;
      }
      if (record.expiresAt != null && bar.openTime >= record.expiresAt) {
        expire(record);
        break;
      }
      record.pendingEvaluatedBars++;
      lastPendingClose = bar.closeTime;
      const entryTouched = bar.low <= record.entry && bar.high >= record.entry;
      const stop = stopTouched(record, record.stop, bar);
      const target = options.invalidateOnTargetTaken && targetTouched(record, bar);
      if (bar.open === record.entry) {
        setEntry(record, bar, true);
        processActive(record, bar, activeStop, false);
        continue;
      }
      const direction = record.direction === 'long' ? 1 : -1;
      const stopAtOpen = direction * (bar.open - record.stop) <= 0;
      const targetAtOpen = options.invalidateOnTargetTaken
        && direction * (bar.open - record.target.price) >= 0;
      if (stopAtOpen || targetAtOpen) {
        record.observedExitOpen = bar.open;
        finish(record, 'INVALIDATED', bar, { exact: true,
          reference: stopAtOpen ? record.stop : record.target.price,
          note: stopAtOpen
            ? 'The opening price already crossed the structural invalidation stop before any later retest; there is no gap entry fill.'
            : 'The opening price already took the liquidity target before any later retest; there is no gap entry fill or profit.' });
        break;
      }

      // Expiry inside a candle adds a second unknown ordering boundary.
      if (record.expiresAt != null && bar.closeTime >= record.expiresAt) {
        if (entryTouched || stop || target) {
          pendingAmbiguity(record, bar, { entryTouched, triggered: entryTouched ? null : false,
            note: 'The candle straddles setup expiry; event timing relative to expiry is unknown.' });
        } else expire(record);
        break;
      }
      if (entryTouched && (stop || targetTouched(record, bar))) {
        pendingAmbiguity(record, bar, {
          entryTouched: true,
          triggered: stop || target ? null : true,
          note: 'The retest and an SL/target touch share a candle whose open is not the entry. Entry, invalidation, and exit ordering cannot be established.',
        });
        break;
      }
      if (!entryTouched && (stop || target)) {
        finish(record, 'INVALIDATED', bar, { note: stop
          ? 'The structural stop was touched without a reference-level entry.'
          : 'The liquidity target was taken without an entry; no profit is counted.' });
        break;
      }
      if (entryTouched) {
        setEntry(record, bar, false);
        processActive(record, bar, activeStop, true);
      }
      continue;
    }

    // Only confirmed evidence from a PREVIOUS bar can move the stop to entry.
    // The lower MFE bound, not a possibly pre-entry wick, must meet the threshold.
    if (options.breakevenAfterR != null && record.breakevenActivatedAt == null
        && record.maxRLower >= options.breakevenAfterR) {
      activeStop = record.entry;
      record.activeStop = activeStop;
      record.breakevenActivatedAt = bar.openTime;
    }
    processActive(record, bar, activeStop, false);
  }
  if (!record.outcome && !record.triggered && record.expiresAfterBars != null
      && record.pendingEvaluatedBars >= record.expiresAfterBars) expire(record, lastPendingClose);
  if (!record.outcome) {
    record.outcome = record.triggered ? 'OPEN' : 'NOT_TRIGGERED';
    if (!record.triggered) {
      record.pendingAtEnd = true;
      record.untriggeredReason = 'END_OF_HISTORY';
    }
    record.notes.push(record.triggered
      ? 'The position has not reached its active stop or fixed target by the end of supplied history.'
      : 'No qualifying reference-level retest is established in supplied future history.');
  }
  return record;
}

function emptyCounts() {
  return { total: 0, triggered: 0, untriggered: 0, ambiguousEntry: 0,
    WIN: 0, LOSS: 0, BE: 0, INVALIDATED: 0, NOT_TRIGGERED: 0, OPEN: 0, AMBIGUOUS: 0,
    expiredBeforeEntry: 0, pendingAtEnd: 0 };
}

function addCount(counts, record) {
  counts.total++;
  if (record.triggered === true) counts.triggered++;
  else if (record.triggered === false) counts.untriggered++;
  else counts.ambiguousEntry++;
  counts[record.outcome === 'BREAKEVEN' ? 'BE' : record.outcome]++;
  if (record.untriggeredReason === 'EXPIRED') counts.expiredBeforeEntry++;
  if (record.pendingAtEnd) counts.pendingAtEnd++;
}

/**
 * Options:
 *   invalidateOnTargetTaken: true by default; invalidate unused liquidity.
 *   breakevenAfterR: disabled by default. Explicit positive threshold moves
 *     the stop to entry on the NEXT bar after confirmed lower-bound MFE reaches it.
 *   includeRReferences: false by default. Optional 1R/2R/3R price references
 *     are informational and never replace the supplied liquidity target.
 * expiresAt limits pending entry only; mid-candle expiry cannot invent order.
 * expiresAfterBars alternatively permits that many whole eligible chart bars,
 * then expires at the final permitted close. It requires no future session data.
 * Exact timestamps are limited to known opening-price events or explicit expiry.
 * maxR bounds describe possible favorable movement before modeled exit, not P&L.
 * riskPercent is stop distance as a percentage of the positive entry quote,
 * not position sizing or percentage of account capital at risk.
 * riskPriceDistance is in quote-price units. riskPoints/riskPips require supplied
 * positive tickSize/pipSize metadata; otherwise they are null, never inferred.
 */
export function auditSetups(setups, candles, options = {}) {
  if (!Array.isArray(setups)) throw new TypeError('setups must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  if (options.invalidateOnTargetTaken != null && typeof options.invalidateOnTargetTaken !== 'boolean') {
    throw new TypeError('invalidateOnTargetTaken must be boolean');
  }
  if (options.includeRReferences != null && typeof options.includeRReferences !== 'boolean') {
    throw new TypeError('includeRReferences must be boolean');
  }
  if (options.breakevenAfterR != null
      && (!Number.isFinite(options.breakevenAfterR) || options.breakevenAfterR <= 0)) {
    throw new RangeError('breakevenAfterR must be a positive R threshold');
  }
  const settings = { invalidateOnTargetTaken: options.invalidateOnTargetTaken ?? true,
    breakevenAfterR: options.breakevenAfterR ?? null,
    includeRReferences: options.includeRReferences ?? false };
  const history = validateCandles(candles);
  const ids = new Set();
  const records = setups.map((setup, index) => validateSetup(setup, index, ids))
    .map(record => {
      if (settings.includeRReferences) {
        const direction = record.direction === 'long' ? 1 : -1;
        record.rReferences = Object.fromEntries([1, 2, 3].map(r => {
          const price = record.entry + direction * r * record.risk;
          if (!Number.isFinite(price)) throw new RangeError(`Non-finite R reference for ${record.id}`);
          return [`${r}R`, price];
        }));
        record.notes.push('1R/2R/3R prices are informational references; the supplied named liquidity target is the sole profit-exit threshold.');
      }
      if (record.score != null || record.qualificationEvidence != null || record.zone != null) {
        record.notes.push('Score, qualification evidence, and zone were supplied externally and are preserved without structural certification.');
      }
      return auditRecord(record, history, settings);
    });
  const summary = emptyCounts();
  const grades = new Map();
  for (const record of records) {
    if (!OUTCOMES.includes(record.outcome)) throw new Error('Unexpected audit outcome');
    addCount(summary, record);
    if (!grades.has(record.grade)) grades.set(record.grade, emptyCounts());
    addCount(grades.get(record.grade), record);
  }
  summary.byGrade = Object.fromEntries(grades);
  summary.sourceModel = MODEL;
  summary.options = settings;
  summary.notes = [
    'All supplied setups are audited independently, including overlaps; none are capped or discarded.',
    'Setup qualification and target evidence are supplied, not detected or certified by this engine.',
    'Only candles opening at or after qualification are evaluated. OHLC cannot recover unknown intrabar order.',
    'WIN means the supplied target was reached after an established entry; it is not a return or execution-quality claim.',
    'MFE bounds are capped at fixed target RR. No favorable gap-price improvement or fees/spread are modeled.',
    'riskPercent is stop distance divided by entry quote, not percentage of account capital at risk.',
    'Instrument points and pips require supplied tickSize and pipSize; no EURUSD unit convention is inferred.',
    'BE is the summary key for the BREAKEVEN record outcome; ambiguous entries have triggered=null.',
  ];
  return { records, summary };
}
