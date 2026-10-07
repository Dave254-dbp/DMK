import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStructuralSetups } from '../scripts/structural-setups.mjs';
import { auditSetups } from '../scripts/setup-audit.mjs';

const start = 10_000_000;
const duration = 15 * 60_000;
const row = (index, open, high, low, close) => ({
  openTime: start + index * duration, closeTime: start + (index + 1) * duration,
  open, high, low, close, volume: 100,
});
function fixture({ direction = 1, grades, legacyBars = [1, 3, 4], targetHigh = 120 } = {}) {
  const candles = [
    row(0, 100, 102, 98, 100),
    row(1, 100, 101, 94, 96),
    row(2, 96, 100, 96, 99),
    row(3, 99, 107, 99, 106),
    row(4, 106, 109, 105, 108),
    row(5, 108, 110, 101, 106),
    row(6, 106, 121, 105, 120),
  ];
  const plots = {};
  const put = (name, values) => { plots[name] = { data: values.map(value => ({ value })) }; };
  for (const tier of ['M', 'W', 'D', '4H', '1H', 'E']) {
    put(`Audit Trend ${tier}`, candles.map((_, index) => grades?.[tier]?.[index] ?? 1));
    put(`Audit Pending up ${tier}`, candles.map(() => 0));
    put(`Audit Pending down ${tier}`, candles.map(() => 0));
  }
  put('Audit Confirmed pivot high', candles.map((_, index) => index === 0 ? 105 : NaN));
  put('Audit Confirmed pivot low', candles.map((_, index) => index === 0 ? 95 : NaN));
  put('Audit Event E', candles.map((_, index) => index === 3 ? 3 : 1));
  put('Audit Direction E', candles.map(() => 1));
  put('A+ Buy', candles.map((_, index) => legacyBars.includes(index)));
  put('A+ Sell', candles.map(() => false));
  const dailyCandles = [
    { openTime: 0, closeTime: start, open: 100, high: targetHigh, low: 90, close: 100, volume: 100 },
    { openTime: start, closeTime: start + 86_400_000, open: 100, high: 130, low: 80, close: 110, volume: 100 },
  ];
  if (direction === -1) {
    for (const candle of [...candles, ...dailyCandles]) {
      const { open, high, low, close } = candle;
      Object.assign(candle, { open: 200 - open, high: 200 - low, low: 200 - high, close: 200 - close });
    }
    for (const tier of ['M', 'W', 'D', '4H', '1H', 'E']) {
      plots[`Audit Trend ${tier}`].data.forEach(point => { point.value *= -1; });
    }
    put('Audit Confirmed pivot high', candles.map((_, index) => index === 0 ? 105 : NaN));
    put('Audit Confirmed pivot low', candles.map((_, index) => index === 0 ? 95 : NaN));
    put('A+ Sell', candles.map((_, index) => legacyBars.includes(index)));
    put('A+ Buy', candles.map(() => false));
    plots['Audit Direction E'].data.forEach(point => { point.value = -1; });
  }
  return { ctx: { plots }, candles, metadata: { symbol: 'FIXTURE:EURUSD', data: 'Handcrafted test OHLC; not market data',
    symbolInfo: { mintick: 0.1 } }, dailyCandles };
}

test('strict long sequence freezes FVG retest, sweep stop and native-day liquidity target', () => {
  const input = fixture();
  const result = detectStructuralSetups(input);
  assert.equal(result.setups.length, 1);
  const [setup] = result.setups;
  assert.equal(setup.grade, 'A+');
  assert.equal(setup.direction, 'long');
  assert.equal(setup.knownAt, input.candles[4].closeTime);
  assert.equal(setup.entry, 102.5);
  assert.equal(setup.stop, 93.9);
  assert.equal(setup.target.price, 120);
  assert.equal(setup.target.name, 'PDH');
  assert.equal(setup.target.knownAt, start);
  assert.equal(setup.expiresAfterBars, 24);
  assert.equal(setup.expiresAt, null);
  assert.equal(setup.qualificationEvidence.mss.confirmedAt, input.candles[3].closeTime);
  assert.equal(setup.qualificationEvidence.sweep.mssReference, undefined);
  const audit = auditSetups(result.setups, input.candles);
  assert.equal(audit.records[0].outcome, 'WIN');
  assert.equal(audit.records[0].entryTimeFrom, input.candles[5].openTime);
  assert.equal(audit.records[0].entryTime, null, 'No exact intrabar retest timestamp is invented');
});

test('short sequence uses the opposing prior-native-day low', () => {
  const result = detectStructuralSetups(fixture({ direction: -1 }));
  assert.equal(result.setups.length, 1);
  assert.equal(result.setups[0].direction, 'short');
  assert.equal(result.setups[0].entry, 97.5);
  assert.equal(result.setups[0].stop, 106.1);
  assert.equal(result.setups[0].target.name, 'PDL');
  assert.equal(result.setups[0].target.price, 80);
});

test('near edge is configurable without moving the structural stop or liquidity target', () => {
  const result = detectStructuralSetups(fixture(), { entryMode: 'near-edge' });
  assert.equal(result.setups[0].entry, 105);
  assert.equal(result.setups[0].stop, 93.9);
  assert.equal(result.setups[0].target.price, 120);
});

test('every original A+ label is cataloged independently of structural trade qualification', () => {
  const result = detectStructuralSetups(fixture());
  assert.equal(result.legacyAudit.records.length, 3);
  assert.equal(result.legacyAudit.records[0].executionQualification.qualified, false);
  assert.deepEqual(result.legacyAudit.records[0].executionQualification.reasonCodes, ['MSS_NOT_CONFIRMED']);
  assert.equal(result.legacyAudit.records[1].executionQualification.qualified, false);
  assert.equal(result.legacyAudit.records[2].executionQualification.qualified, true);
  for (const record of result.legacyAudit.records) {
    assert.equal(record.outcome, null);
    assert.equal(record.entry, null);
    assert.equal(record.stop, null);
    assert.equal(record.target, null);
    for (const value of Object.values(record.qualificationEvidence ?? {})) {
      if (value?.confirmedAt) assert.ok(value.confirmedAt <= record.signalConfirmedAt);
    }
  }
});

test('an alignment-only signal lacking a sweep is retained without a fabricated loss', () => {
  const input = fixture();
  input.candles[1].low = 96;
  const result = detectStructuralSetups(input);
  assert.equal(result.setups.length, 0);
  assert.equal(result.legacyAudit.records.length, 3);
  assert.ok(result.legacyAudit.records.every(record => record.executionQualification.reasonCodes.includes('PRIOR_CONFIRMED_SWEEP_MISSING')));
});

test('confirmed reference cannot be used for a sweep in its own earlier candle range', () => {
  const input = fixture();
  input.ctx.plots['Audit Confirmed pivot low'].data[0].value = NaN;
  input.ctx.plots['Audit Confirmed pivot low'].data[1].value = 95;
  assert.equal(detectStructuralSetups(input).setups.length, 0);
});

test('FVG and MSS confirmation bars cannot retrospectively trigger the entry', () => {
  const input = fixture();
  const result = detectStructuralSetups(input);
  const [record] = auditSetups(result.setups, input.candles.slice(0, 5)).records;
  assert.equal(record.triggered, false);
  assert.equal(record.outcome, 'NOT_TRIGGERED');
  assert.equal(record.evaluatedBars, 0);
});

test('future price and daily-history perturbations cannot change an already armed setup or earlier legacy evidence', () => {
  const input = fixture();
  const baseline = detectStructuralSetups(input);
  const perturbed = structuredClone(input);
  Object.assign(perturbed.candles[5], { open: 108, high: 500, low: 1, close: 250 });
  Object.assign(perturbed.candles[6], { open: 250, high: 700, low: 2, close: 350 });
  Object.assign(perturbed.dailyCandles[1], { high: 1000, low: 1, close: 500 });
  const actual = detectStructuralSetups(perturbed);
  assert.deepEqual(actual.setups[0], baseline.setups[0]);
  assert.deepEqual(actual.legacyAudit.records, baseline.legacyAudit.records);
});

test('target consumed on the arming bar cannot be retrospectively selected', () => {
  const input = fixture();
  input.candles[4].high = 121;
  const result = detectStructuralSetups(input);
  assert.equal(result.setups.length, 0);
  assert.ok(result.structuralCandidates[0].qualificationAttempts.some(attempt => attempt.reasonCodes.includes('NO_UNCONSUMED_OPPOSING_LIQUIDITY_TARGET')));
});

test('consumed liquidity cannot supply a repeated sweep', () => {
  const input = fixture();
  input.candles.push(row(7, 100, 102, 94, 96));
  for (const plot of Object.values(input.ctx.plots)) plot.data.push({ value: NaN });
  for (const tier of ['M', 'W', 'D', '4H', '1H', 'E']) input.ctx.plots[`Audit Trend ${tier}`].data[7].value = 1;
  const result = detectStructuralSetups(input);
  assert.equal(result.structuralCandidates.length, 1);
});

test('missing native-day history blocks day-only targets without inventing UTC daily bars', () => {
  const input = fixture();
  delete input.dailyCandles;
  const result = detectStructuralSetups(input, { targetMode: 'pdh-pdl-only' });
  assert.equal(result.setups.length, 0);
  assert.ok(result.diagnostics.some(note => note.includes('Native daily history is missing')));
  assert.ok(result.structuralCandidates[0].qualificationAttempts.some(attempt => attempt.reasonCodes.includes('NATIVE_DAILY_HISTORY_MISSING')));
});

test('native-day high is unavailable before the actual next native daily open', () => {
  const input = fixture();
  input.dailyCandles[0].closeTime = start + 5 * duration;
  input.dailyCandles[1].openTime = start + 5 * duration;
  Object.assign(input.candles[5], { open: 108, high: 110, low: 106, close: 107 });
  const result = detectStructuralSetups(input, { targetMode: 'pdh-pdl-only' });
  assert.equal(result.setups.length, 1);
  assert.equal(result.setups[0].knownAt, input.candles[5].closeTime);
  assert.equal(result.setups[0].target.knownAt, input.candles[5].openTime);
  assert.equal(result.legacyAudit.records[2].executionQualification.qualified, false);
});

test('unknown initial-day consumption is excluded rather than assumed available', () => {
  const input = fixture();
  input.dailyCandles[0].closeTime = start - 1;
  input.dailyCandles[1].openTime = start - 1;
  const result = detectStructuralSetups(input, { targetMode: 'pdh-pdl-only' });
  assert.equal(result.setups.length, 0);
  assert.ok(result.diagnostics.some(note => note.startsWith('Initial previous-day')));
});

test('nearest-liquidity can use a confirmed unconsumed execution swing without daily history', () => {
  const input = fixture();
  delete input.dailyCandles;
  input.ctx.plots['Audit Confirmed pivot high'].data[2].value = 120;
  const result = detectStructuralSetups(input);
  assert.equal(result.setups.length, 1);
  assert.equal(result.setups[0].target.kind, 'execution-swing');
  assert.equal(result.setups[0].target.knownAt, input.candles[2].closeTime);
});

test('B retains structural execution requirements and is opt-in with neutral optional tiers', () => {
  const input = fixture();
  for (const tier of ['M', 'W']) input.ctx.plots[`Audit Trend ${tier}`].data.forEach(point => { point.value = 0; });
  assert.equal(detectStructuralSetups(input).setups.length, 0);
  const enabled = detectStructuralSetups(input, { includeB: true });
  assert.equal(enabled.setups.length, 1);
  assert.equal(enabled.setups[0].grade, 'B');
  assert.equal(enabled.setups[0].entry, 102.5);
  input.ctx.plots['Audit Trend M'].data.forEach(point => { point.value = -1; });
  assert.equal(detectStructuralSetups(input, { includeB: true }).setups.length, 0);
  assert.equal(detectStructuralSetups(input, { includeB: true, allowOpposingOptional: true }).setups[0].grade, 'B');
});

test('waiting optional tiers never qualify as neutral B', () => {
  const input = fixture();
  for (const tier of ['M', 'W']) input.ctx.plots[`Audit Trend ${tier}`].data.forEach(point => { point.value = NaN; });
  assert.equal(detectStructuralSetups(input, { includeB: true, allowOpposingOptional: true }).setups.length, 0);
});

test('structural sequence expires causally and order expiry is expressed in observed future bars', () => {
  const result = detectStructuralSetups(fixture(), { sequenceExpiryBars: 1, expiryBars: 2 });
  assert.equal(result.setups.length, 0);
  assert.equal(result.structuralCandidates[0].state, 'EXPIRED');
  const normal = detectStructuralSetups(fixture(), { expiryBars: 2 });
  assert.equal(normal.setups[0].expiresAfterBars, 2);
  assert.equal(normal.setups[0].expiresAt, null);
  assert.equal(normal.settings.sequenceExpiryBars, 24, 'Pending-order expiry does not silently change sequence validity');
});

test('opposing sweeps in the same candle are rejected without invented direction order', () => {
  const input = fixture();
  Object.assign(input.candles[1], { open: 100, high: 106, low: 94, close: 100 });
  const result = detectStructuralSetups(input);
  assert.equal(result.structuralCandidates.length, 0);
  assert.equal(result.setups.length, 0);
  assert.deepEqual(result.structuralRejections[0].reasonCodes, ['DUAL_SWEEP_AMBIGUOUS']);
  assert.ok(result.legacyAudit.records[0].executionQualification.reasonCodes.includes('DUAL_SWEEP_AMBIGUOUS'));
});

test('a newly confirmed pivot touched by its own confirmation candle is not an untouched target', () => {
  const input = fixture();
  delete input.dailyCandles;
  input.candles[4].high = 121;
  input.ctx.plots['Audit Confirmed pivot high'].data[4].value = 120;
  const result = detectStructuralSetups(input);
  assert.equal(result.setups.length, 0);
  assert.ok(result.structuralCandidates[0].qualificationAttempts.some(attempt => attempt.reasonCodes.includes('NO_UNCONSUMED_OPPOSING_LIQUIDITY_TARGET')));
});

test('bad option and unavailable audit data errors are explicit', () => {
  assert.throws(() => detectStructuralSetups(fixture(), { entryMode: 'close' }), /entryMode/);
  assert.throws(() => detectStructuralSetups(fixture(), { expiryBars: 0 }), /expiryBars/);
  const input = fixture();
  delete input.metadata.symbolInfo;
  assert.throws(() => detectStructuralSetups(input, { stopBufferTicks: 1 }), /tickSize/);
  delete input.ctx.plots['Audit Trend D'];
  assert.throws(() => detectStructuralSetups(input), /auditContext/);
});

test('prearming invalidation uses the same frozen buffered structural stop', () => {
  const input = fixture();
  input.candles[2].low = 94;
  assert.equal(detectStructuralSetups(input).setups.length, 1, 'A sweep-extreme touch within the selected stop buffer does not invent a stop touch');
  input.candles[2].low = 93.9;
  const stopped = detectStructuralSetups(input);
  assert.equal(stopped.setups.length, 0);
  assert.ok(stopped.structuralCandidates[0].reasonCodes.includes('PLANNED_STRUCTURAL_STOP_TAKEN_BEFORE_ARMING'));
});

test('midpoint rounds to an instrument tick without changing the confirmed zone', () => {
  const input = fixture();
  input.candles[4].low = 105.1;
  const [setup] = detectStructuralSetups(input).setups;
  assert.equal(setup.entry, 102.6, 'Exact half-tick rounds up despite binary floating point');
  assert.equal(setup.zone.low, 100);
  assert.equal(setup.zone.high, 105.1);
  assert.equal(setup.stop, 93.9);
});

test('explicit unknown tick metadata overrides runtime placeholders and no rule typo is ignored', () => {
  const result = detectStructuralSetups(fixture(), { tickSize: null });
  assert.equal(result.setups[0].tickSize, null);
  assert.equal(result.setups[0].stop, 94);
  assert.equal(result.settings.stopBufferTicks, 0);
  assert.ok(result.diagnostics.some(note => note.includes('tick size is unknown')));
  assert.throws(() => detectStructuralSetups(fixture(), { entryPolcy: 'near-edge' }), /Unknown structural rule: entryPolcy/);
});

test('dual sweep stays ambiguous when only one side has a valid opposite MSS pivot', () => {
  const input = fixture();
  input.ctx.plots['Audit Confirmed pivot low'].data[0].value = NaN;
  Object.assign(input.candles[1], { open: 100, high: 121, low: 89, close: 100 });
  const result = detectStructuralSetups(input);
  assert.equal(result.structuralCandidates.length, 0);
  assert.ok(result.structuralRejections[0].reasonCodes.includes('DUAL_SWEEP_AMBIGUOUS'));
});

test('legacy audit does not inherit TradingView drawing limits or drop older labels', () => {
  const input = fixture();
  input.candles = Array.from({ length: 750 }, (_, index) => row(index, 100, 102, 98, 100));
  for (const [name, plot] of Object.entries(input.ctx.plots)) {
    const value = name.startsWith('Audit Trend') ? 1 : name === 'A+ Buy' ? true
      : name.startsWith('Audit Confirmed pivot') ? NaN : 0;
    plot.data = input.candles.map(() => ({ value }));
  }
  const result = detectStructuralSetups(input);
  assert.equal(result.legacyAudit.records.length, 750);
  assert.equal(result.counts.legacyAPlus, 750);
  assert.equal(result.legacyAudit.records[0].signalBarOpen, input.candles[0].openTime);
  assert.equal(result.legacyAudit.records.at(-1).signalBarOpen, input.candles.at(-1).openTime);
});
