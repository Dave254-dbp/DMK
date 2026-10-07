import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PineTS } from 'pinets';

// An optional source path lets the same assertions verify an older revision
// fails, without replacing the working indicator during other runtime checks.
const source = await readFile(
  process.env.DMK_TEST_SOURCE || new URL('../DMK.pine', import.meta.url),
  'utf8',
);

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

// Execute source fragments, rather than JavaScript versions of the algorithms.
// Comment boundaries survive changes to line numbers and guard placement.
const scanBlock = sourceBetween(
  '    // Collect all close-confirmed same-bar breaks, newest protected level first.',
  '    // One primary event per bar.',
).replace(/^ {4}/gm, '');
const conflictBlock = sourceBetween(
  'int bullCount =',
  '// Optional location proxy.',
);

function pineFloat(value) {
  return Number.isNaN(value) ? 'na' : Number.isInteger(value) ? `${value}.0` : String(value);
}

function pineArray(values) {
  return values.length === 0
    ? 'array.new<float>()'
    : `array.from(${values.map(pineFloat).join(', ')})`;
}

async function runFixture(body, close = 105) {
  const openTime = 1704067200000;
  const candles = [{
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
    openTime,
    closeTime: openTime + 300000 - 1,
  }];
  const context = await new PineTS(candles, 'TEST', '5').run(
    `//@version=6\nindicator("DMK regression fixture")\n${body}`,
  );
  return (name) => {
    assert.ok(context.plots[name], `Missing fixture plot: ${name}`);
    const sample = context.plots[name].data.at(-1);
    assert.ok(sample, `Missing fixture sample: ${name}`);
    return sample.value;
  };
}

async function assertScan({
  highs = [], lows = [], close = 105, buffer = 1, atr = 10,
  retainedHighs = [], retainedLows = [], primaryHigh = NaN, primaryLow = NaN,
}) {
  const observeEntries = (values, name, prefix) => values.map((_, index) =>
    `plot(array.size(${name}) > ${index} ? array.get(${name}, ${index}) : na, "${prefix}${index}")`,
  ).join('\n');
  const value = await runFixture(`
var array<float> activeHighs = ${pineArray(highs)}
var array<float> activeLows = ${pineArray(lows)}
float atrValue = ${pineFloat(atr)}
float buffer = ${pineFloat(buffer)}
${scanBlock}
plot(array.size(activeHighs), "highCount")
plot(array.size(activeLows), "lowCount")
plot(highBreak ? 1 : 0, "highBreak")
plot(lowBreak ? 1 : 0, "lowBreak")
plot(primaryHighLevel, "primaryHigh")
plot(primaryLowLevel, "primaryLow")
${observeEntries(retainedHighs, 'activeHighs', 'high')}
${observeEntries(retainedLows, 'activeLows', 'low')}
`, close);
  assert.equal(value('highCount'), retainedHighs.length, 'Retained high count');
  assert.equal(value('lowCount'), retainedLows.length, 'Retained low count');
  assert.equal(value('highBreak'), Number(!Number.isNaN(primaryHigh)), 'High break');
  assert.equal(value('lowBreak'), Number(!Number.isNaN(primaryLow)), 'Low break');
  assert.equal(value('primaryHigh'), primaryHigh, 'Newest crossed high is primary');
  assert.equal(value('primaryLow'), primaryLow, 'Newest crossed low is primary');
  assert.deepEqual(retainedHighs.map((_, index) => value(`high${index}`)), retainedHighs);
  assert.deepEqual(retainedLows.map((_, index) => value(`low${index}`)), retainedLows);
}

test('a newer unbroken high does not hide an older crossed high', async () => {
  await assertScan({ highs: [100, 110], close: 105, retainedHighs: [110], primaryHigh: 100 });
});

test('a newer unbroken low does not hide an older crossed low', async () => {
  await assertScan({ lows: [100, 90], close: 95, retainedLows: [90], primaryLow: 100 });
});

test('mixed arrays preserve retained order and select the newest crossed level', async () => {
  await assertScan({
    highs: [100, 120, 105, 130, 103],
    lows: [120, 80, 115, 75, 117],
    close: 110,
    retainedHighs: [120, 130],
    retainedLows: [80, 75],
    primaryHigh: 103,
    primaryLow: 117,
  });
});

test('empty arrays produce no break and no primary level', async () => {
  await assertScan({});
});

test('all 100 entries per side can be crossed without skipped or invalid indices', async () => {
  await assertScan({
    highs: Array.from({ length: 100 }, (_, index) => 100 + index),
    lows: Array.from({ length: 100 }, (_, index) => 1100 + index),
    close: 500,
    primaryHigh: 199,
    primaryLow: 1199,
  });
});

test('close equal to high plus buffer does not break the high', async () => {
  await assertScan({ highs: [100], close: 101, retainedHighs: [100] });
});

test('close equal to low minus buffer does not break the low', async () => {
  await assertScan({ lows: [100], close: 99, retainedLows: [100] });
});

test('unavailable ATR preserves both arrays without classifying breaks', async () => {
  await assertScan({
    highs: [100, 110], lows: [120, 90], close: 105, atr: NaN,
    retainedHighs: [100, 110], retainedLows: [120, 90],
  });
});

async function assertConflict({ direction, monthly, weekly, allowOpposing = false, minAligned = 5, allowed }) {
  const pineTrend = (trend) => Number.isNaN(trend) ? 'na' : String(trend);
  const value = await runFixture(`
int trendM = ${pineTrend(monthly)}
int trendW = ${pineTrend(weekly)}
int trendD = ${direction}
int trend4H = ${direction}
int trend1H = ${direction}
int trendE = ${direction}
bool allowOpposing = ${allowOpposing}
int minAligned = ${minAligned}
${conflictBlock}
plot(coreBull ? 1 : 0, "coreBull")
plot(coreBear ? 1 : 0, "coreBear")
plot(noBullConflict ? 1 : 0, "noBullConflict")
plot(noBearConflict ? 1 : 0, "noBearConflict")
plot(coreBull and bullCount >= minAligned and noBullConflict ? 1 : 0, "longAllowed")
plot(coreBear and bearCount >= minAligned and noBearConflict ? 1 : 0, "shortAllowed")
`);
  const isLong = direction === 1;
  assert.equal(value(isLong ? 'coreBull' : 'coreBear'), 1, 'Core tiers agree');
  assert.equal(value(isLong ? 'noBullConflict' : 'noBearConflict'), Number(allowed), 'Conflict gate');
  assert.equal(value(isLong ? 'longAllowed' : 'shortAllowed'), Number(allowed), 'Alignment and conflict eligibility');
  assert.equal(value(isLong ? 'shortAllowed' : 'longAllowed'), 0, 'Opposite-direction core is blocked');
}

for (const direction of [1, -1]) {
  const side = direction === 1 ? 'long' : 'short';
  for (const missing of ['Monthly', 'Weekly', 'both']) {
    test(`${side}: unavailable ${missing} optional state cannot pass the default conflict gate`, async () => {
      await assertConflict({
        direction,
        monthly: missing === 'Monthly' || missing === 'both' ? NaN : direction,
        weekly: missing === 'Weekly' || missing === 'both' ? NaN : direction,
        minAligned: missing === 'both' ? 4 : 5,
        allowed: false,
      });
    });
  }

  test(`${side}: an available neutral optional tier is accepted`, async () => {
    await assertConflict({ direction, monthly: 0, weekly: direction, allowed: true });
  });

  test(`${side}: an available opposing optional tier remains blocked by default`, async () => {
    await assertConflict({ direction, monthly: -direction, weekly: direction, allowed: false });
  });

  test(`${side}: allowOpposing preserves its bypass for missing and opposing optional tiers`, async () => {
    await assertConflict({
      direction, monthly: NaN, weekly: -direction, allowOpposing: true, minAligned: 4, allowed: true,
    });
  });
}
