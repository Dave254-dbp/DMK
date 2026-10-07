import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Indicator, PineTS } from 'pinets';
import { createDataProvider, createSyntheticProvider, instrumentAuditContext, runIndicator } from '../scripts/runtime.mjs';
import { detectStructuralSetups } from '../scripts/structural-setups.mjs';
import { auditSetups } from '../scripts/setup-audit.mjs';

const executionPath = new URL('../DMK-execution.pine', import.meta.url);
const source = await readFile(executionPath, 'utf8');
const start = Date.UTC(2024, 0, 1);
const duration = 300000;
const bar = (index, open, high, low, close = open) => ({
  openTime: start + index * duration, closeTime: start + (index + 1) * duration,
  open, high, low, close, volume: 100,
});
const mirror = candles => candles.map(c => ({ ...c,
  open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close,
}));
const observe = (ctx, name) => ctx.plots[name].data.map(point => point.value);
const final = (ctx, name) => observe(ctx, name).at(-1);

function between(startMarker, endMarker) {
  const begin = source.indexOf(startMarker);
  assert.notEqual(begin, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, begin + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(begin, end);
}

// Execute the indicator's actual types and helper bodies, not JS translations.
const helpers = between('// Raw swing liquidity', 'var array<Liquidity> upperPool');
async function stepFixture(candles, { direction = 1, armedBar = -1, expiry = 24, be = false } = {}) {
  const fixture = `//@version=6
indicator("Execution audit fixture")
bool useBreakeven = ${be}
float breakevenAfterR = 1
int expiryBars = ${expiry}
bool showRReferences = false
string auditTimezone = "Etc/UTC"
${helpers}
var Execution s = Execution.new()
if barstate.isfirst
    s.id := 1
    s.dir := ${direction}
    s.grade := 6
    s.score := 6
    s.entry := 100
    s.stop := ${direction === 1 ? 99 : 101}
    s.target := ${direction === 1 ? 103 : 97}
    s.risk := 1
    s.rr := 3
    s.armedBar := ${armedBar}
if barstate.isconfirmed
    f_evaluate(s)
plot(s.outcome, "outcome")
plot(s.state, "state")
plot(s.triggered, "triggered")
plot(s.entryTime, "entryTime")
plot(s.entryFrom, "entryFrom")
plot(s.entryTo, "entryTo")
plot(s.outcomeTime, "outcomeTime")
plot(s.mfeLower, "lower")
plot(s.mfeUpper, "upper")
plot(s.beActive ? 1 : 0, "beActive")
`;
  const ctx = await new PineTS(candles, 'FIXTURE', '5').run(fixture);
  assert.deepEqual(ctx.warnings, []);
  return ctx;
}

const cases = [
  ['opening retest then liquidity target', [bar(0, 100, 103.2, 99.2, 102)], 1, 1],
  ['opening retest then structural stop', [bar(0, 100, 100.8, 98.9, 99.5)], 2, 1],
  ['active SL and target share a candle', [bar(0, 100, 103.2, 98.9, 100.5)], 6, 1],
  ['intrabar entry and SL ordering unknown', [bar(0, 100.5, 100.8, 98.9, 100.4)], 6, 2],
  ['intrabar entry and target ordering unknown', [bar(0, 100.5, 103.2, 99.5, 101)], 6, 2],
  ['pending opening SL invalidation before later retest', [bar(0, 98.5, 100.5, 98, 100.2)], 4, 0],
  ['pending opening target invalidation before later retest', [bar(0, 103.5, 104, 99.5, 100.2)], 4, 0],
  ['pending liquidity taken without entry', [bar(0, 101, 103.2, 100.4, 102)], 4, 0],
  ['no retest remains waiting', [bar(0, 101, 102, 100.5, 101.5)], 0, 0],
  ['safe gap skipping entry does not invent a reference-level retest', [bar(0, 99.5, 99.8, 99.2, 99.6)], 0, 0],
  ['entry remains independently open', [bar(0, 100, 100.8, 99.2, 100.5)], 0, 1],
  ['active opening SL gap precedes later target', [bar(0, 100, 100.8, 99.2, 100.5), bar(1, 98.5, 104, 98, 103)], 2, 1],
  ['active opening target gap precedes later SL', [bar(0, 100, 100.8, 99.2, 100.5), bar(1, 103.5, 104, 98, 99)], 1, 1],
];
for (const direction of [1, -1]) {
  for (const [name, candles, outcome, triggered] of cases) {
    test(`native ${direction === 1 ? 'long' : 'short'}: ${name}`, async () => {
      const ctx = await stepFixture(direction === 1 ? candles : mirror(candles), { direction });
      assert.equal(final(ctx, 'outcome'), outcome);
      assert.equal(final(ctx, 'triggered'), triggered);
      assert.ok(final(ctx, 'lower') <= final(ctx, 'upper'));
      assert.ok(final(ctx, 'upper') <= 3, 'MFE is capped at the fixed actual target');
    });
  }
}

test('native audit helper refuses formation-bar hindsight fills', async () => {
  const ctx = await stepFixture([bar(0, 100, 104, 98, 101)], { armedBar: 0 });
  assert.equal(final(ctx, 'state'), 0);
  assert.equal(final(ctx, 'triggered'), 0);
  assert.equal(final(ctx, 'outcome'), 0);
});

test('native retest uses a timestamp interval unless opening price equals entry', async () => {
  const ctx = await stepFixture([bar(0, 100.5, 101.5, 99.5, 100.2)]);
  assert.ok(Number.isNaN(final(ctx, 'entryTime')));
  assert.equal(final(ctx, 'entryFrom'), start);
  assert.equal(final(ctx, 'entryTo'), start + duration);
  assert.ok(final(ctx, 'lower') < final(ctx, 'upper'));
});

test('native stop candle favorable wick is a bound rather than exact achieved MFE', async () => {
  const ctx = await stepFixture([bar(0, 100, 102, 98.5, 101)]);
  assert.equal(final(ctx, 'outcome'), 2);
  assert.equal(final(ctx, 'lower'), 0);
  assert.equal(final(ctx, 'upper'), 2);
});

test('native pending expiry evaluates every allowed future bar then expires', async () => {
  const ctx = await stepFixture([bar(0, 101, 102, 100.5, 101), bar(1, 101, 102, 100.5, 101)], { expiry: 2 });
  assert.deepEqual(observe(ctx, 'outcome'), [0, 5]);
  assert.equal(final(ctx, 'outcomeTime'), start + 2 * duration);
});

test('native final allowed retest is valid and expiry does not close active positions', async () => {
  const ctx = await stepFixture([bar(0, 101, 102, 100.5, 101), bar(1, 100, 101, 99.5, 100.8), bar(2, 101, 103.2, 100.5, 102)], { expiry: 2 });
  assert.deepEqual(observe(ctx, 'outcome'), [0, 0, 1]);
});

test('native BE is disabled by default and uses prior confirmed MFE when enabled', async () => {
  const candles = [bar(0, 100, 101.2, 99.2, 101), bar(1, 100.6, 102, 99.8, 100.2)];
  assert.equal(final(await stepFixture(candles), 'outcome'), 0);
  const ctx = await stepFixture(candles, { be: true });
  assert.deepEqual(observe(ctx, 'beActive'), [0, 1]);
  assert.equal(final(ctx, 'outcome'), 3);
});

test('native uncertain pre-entry favorable wick cannot activate BE', async () => {
  const ctx = await stepFixture([bar(0, 100.5, 101.5, 99.5, 100.2), bar(1, 100.3, 100.5, 99.5, 100.2)], { be: true });
  assert.equal(final(ctx, 'beActive'), 0);
  assert.equal(final(ctx, 'outcome'), 0);
});

// Full native source fixture: only tier tuples and native-day references are
// external constants. Actual ta pivots, sweep/MSS/FVG code, order tracker,
// graphics, and dashboards remain unchanged. This is not market validation.
function pipelineSource(direction) {
  let fixture = source.replace(/^(\[trend(?:M|W|D|4H|1H),[^\n]+\]) = request\.security[^\n]+$/gm,
    '$1 = f_fixtureTier()');
  fixture = fixture.replace(/^(\[trendE,[^\n]+\]) = f_structure\(\)$/m,
    '$1 = f_fixtureExecution()');
  fixture = fixture.replace(/^(\[pdh, pdl, previousDayKnownAt\]) = request\.security[^\n]+$/m,
    '$1 = f_fixtureDay()');
  fixture = fixture.replace('// Trend:', `f_fixtureTier() =>
    [${direction}, float(na), float(na), false, false]
f_fixtureExecution() =>
    [${direction}, 0, 0, float(na), float(na), false, false]
f_fixtureDay() =>
    [${direction === 1 ? 120 : 110}, ${direction === 1 ? 90 : 80}, ${start}]

// Trend:`);
  assert.equal((fixture.match(/= request\.security/g) ?? []).length, 0, 'Only external request tuples are replaced');
  return `${fixture}\nplot(latest.entryTime, "fixtureEntryTime")\nplot(latest.entryFrom, "fixtureEntryFrom")\nplot(latest.entryTo, "fixtureEntryTo")\nplot(latest.entryBar, "fixtureEntryBar")\nplot(latest.sweepTime, "fixtureSweepTime")\nplot(latest.mssTime, "fixtureMssTime")\nplot(latest.fvgTime, "fixtureFvgTime")\n`;
}
const pipelineCandles = [
  [100, 102, 98, 100], [100, 105, 95, 100], [100, 103, 96, 100],
  [100, 101, 94, 96], [96, 100, 96, 99], [99, 107, 99, 106],
  [106, 109, 105, 108], [108, 110, 101, 106], [106, 121, 105, 120],
].map((values, index) => bar(index, ...values));
async function pipelineFixture(direction = 1, overrides = {}, prefix = pipelineCandles) {
  const candles = direction === 1 ? prefix : mirror(prefix);
  const fixtureProvider = createDataProvider({ '5': candles }, 'STRUCTURAL:FIXTURE', 'Handcrafted structural fixture', { mintick: .01 });
  const ctx = await new PineTS(fixtureProvider, fixtureProvider.symbol, '5', candles.length).run(new Indicator(instrumentAuditContext(pipelineSource(direction)), {
    'Swing bars each side': 1, ...overrides,
  }));
  assert.deepEqual(ctx.warnings, []);
  return ctx;
}

for (const direction of [1, -1]) {
  test(`full native ${direction === 1 ? 'long' : 'short'} pipeline confirms pivots, sweep, later MSS, FVG, retest and WIN`, async () => {
    const ctx = await pipelineFixture(direction);
    const signal = direction === 1 ? 'A+ Limit Long' : 'A+ Limit Short';
    assert.deepEqual(observe(ctx, signal).map(Number), [0, 0, 0, 0, 0, 0, 1, 0, 0]);
    assert.deepEqual(observe(ctx, 'Strict Entered'), [0, 0, 0, 0, 0, 0, 0, 1, 1]);
    assert.equal(final(ctx, 'Strict Total'), 1);
    assert.equal(final(ctx, 'Strict WIN'), 1);
    assert.equal(final(ctx, 'Strict LOSS'), 0);
    assert.equal(final(ctx, 'fixtureSweepTime'), pipelineCandles[3].closeTime);
    assert.equal(final(ctx, 'fixtureMssTime'), pipelineCandles[5].closeTime);
    assert.equal(final(ctx, 'fixtureFvgTime'), pipelineCandles[6].closeTime);
    assert.equal(final(ctx, 'fixtureEntryBar'), 7);
    assert.ok(Number.isNaN(final(ctx, 'fixtureEntryTime')));
    assert.equal(final(ctx, 'fixtureEntryFrom'), pipelineCandles[7].openTime);
    assert.equal(final(ctx, 'fixtureEntryTo'), pipelineCandles[7].closeTime);
    assert.equal(final(ctx, 'Setup Entry'), direction === 1 ? 102.5 : 97.5);
    assert.ok(Math.abs(final(ctx, 'Setup SL') - (direction === 1 ? 93.99 : 106.01)) < 1e-10);
    assert.equal(final(ctx, 'Setup Liquidity Target'), direction === 1 ? 120 : 80);
    assert.equal(final(ctx, 'Setup MFE Lower R'), final(ctx, 'Setup Target RR'));
    assert.equal(final(ctx, 'Setup MFE Upper R'), final(ctx, 'Setup Target RR'));
    const { setups } = detectStructuralSetups({ ctx, candles: ctx.marketData,
      metadata: { symbol: 'STRUCTURAL:FIXTURE', symbolInfo: { mintick: .01 }, inputs: { 'Swing bars each side': 1 } },
      dailyCandles: [
        { openTime: start - 86400000, closeTime: start, open: 100, close: 100,
          high: direction === 1 ? 120 : 110, low: direction === 1 ? 90 : 80 },
        { openTime: start, closeTime: start + 86400000, open: 100, close: 100, high: 140, low: 60 },
      ],
    });
    assert.equal(setups.length, 1, 'Independent structural detector also qualifies this causal fixture');
    assert.equal(setups[0].entry, final(ctx, 'Setup Entry'));
    assert.ok(Math.abs(setups[0].stop - final(ctx, 'Setup SL')) < 1e-10);
    assert.equal(setups[0].target.price, final(ctx, 'Setup Liquidity Target'));
    assert.equal(setups[0].knownAt, pipelineCandles[6].closeTime);
    const { records } = auditSetups(setups, ctx.marketData);
    assert.equal(records[0].outcome, 'WIN');
    assert.equal(records[0].triggered, true);
    assert.ok(Math.abs(records[0].maxRLower - final(ctx, 'Setup MFE Lower R')) < 1e-10);
    assert.ok(Math.abs(records[0].maxRUpper - final(ctx, 'Setup MFE Upper R')) < 1e-10);
  });
}

test('native pipeline future suffix cannot change arming or prior entry evidence', async () => {
  const prefix = await pipelineFixture(1, {}, pipelineCandles.slice(0, 7));
  const longer = await pipelineFixture();
  for (const name of ['A+ Limit Long', 'Strict Total', 'Strict Entered', 'Setup Entry', 'Setup SL', 'Setup Liquidity Target']) {
    assert.deepEqual(observe(longer, name).slice(0, 7), observe(prefix, name));
  }
});

test('native near-edge order cannot fill on its FVG confirmation candle', async () => {
  const ctx = await pipelineFixture(1, { 'FVG entry': 'Near edge' }, pipelineCandles.slice(0, 7));
  assert.equal(final(ctx, 'Setup Entry'), 105);
  assert.equal(final(ctx, 'Strict Total'), 1);
  assert.equal(final(ctx, 'Strict WAIT'), 1);
  assert.equal(final(ctx, 'Strict Entered'), 0);
});

test('native positive pipeline honors level and dashboard suppression inputs', async () => {
  const ctx = await pipelineFixture(1, { 'Show execution levels': false, 'Show dashboards': false });
  assert.equal(final(ctx, 'Strict WIN'), 1);
  assert.ok(ctx.plots.__lines__.data.every(point => point.value.length === 0));
  assert.ok(ctx.plots.__labels__.data.every(point => point.value.length === 0));
  const tables = ctx.plots.__tables__.data.at(-1).value;
  assert.ok(tables.every(table => table.cells.flat().every(cell => !cell?.text)));
});

test('native BE drawing moves the active stop while evidence retains the initial risk', async () => {
  const candles = [...pipelineCandles.slice(0, 8), bar(8, 106, 110, 102, 108)];
  const ctx = await pipelineFixture(1, {
    'Enable breakeven after confirmed MFE': true,
    'Breakeven threshold R (next bar only)': .3,
  }, candles);
  assert.equal(final(ctx, 'Strict BE'), 1);
  assert.ok(Math.abs(final(ctx, 'Setup SL') - 93.99) < 1e-10);
  const labels = ctx.plots.__labels__.data.at(-1).value;
  const stop = labels.find(label => label.text.startsWith('BE SL '));
  assert.equal(stop.y, 102.5);
  const detail = labels.find(label => label.tooltip?.includes('Frozen tiers'));
  assert.ok(detail.text.split('\n').length <= 2, 'Full evidence belongs in the tooltip');
  assert.match(detail.tooltip, /SL 93\.99/);
  assert.match(detail.tooltip, /Active SL 102\.50/);
  const lines = ctx.plots.__lines__.data.at(-1).value;
  assert.ok(lines.some(line => line.y1 === 102.5 && line.y2 === 102.5 && line.color === '#F23645'));
});

test('native grade initialization requires every tier and all core directions', async () => {
  const grading = between('int bullCount =', '// Raw swing liquidity');
  for (const [monthly, execution, expected] of [['na', 1, 0], ['1', -1, 0], ['1', 1, 1]]) {
    const ctx = await new PineTS([bar(0, 100, 101, 99, 100)], 'GRADE:FIXTURE', '5').run(`//@version=6
indicator("Grade fixture")
int trendM = ${monthly}
int trendW = 1
int trendD = 1
int trend4H = 1
int trend1H = 1
int trendE = ${execution}
int minAligned = 5
bool allowOpposing = false
${grading}
plot(qualifyLong ? 1 : 0, "qualified")
`);
    assert.equal(final(ctx, 'qualified'), expected);
  }
});

const provider = createSyntheticProvider();
test('entire native execution source runs all real request contexts without relaxing zero qualification', async () => {
  const { ctx, metadata } = await runIndicator({ provider, sourcePath: executionPath });
  assert.deepEqual(metadata.warnings, []);
  assert.equal(final(ctx, 'Strict Total'), 0);
  assert.equal(ctx.plots.__tables__.data.at(-1).value[0].rows, 11);
});

test('native full execution source keeps its 1H chart restriction active', async () => {
  await assert.rejects(runIndicator({ provider, sourcePath: executionPath, timeframe: '60', bars: 20 }), /below 1H/);
});
