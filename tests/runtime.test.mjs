import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticProvider, runIndicator } from '../scripts/runtime.mjs';
import { buildLegacyCatalog } from '../scripts/audit-context.mjs';

const provider = createSyntheticProvider();

test('entire Pine source runs across all native tiers and emits confirmed graded buys', async () => {
  const { ctx, metadata, candles } = await runIndicator({ provider });
  assert.equal(candles.length, 3000);
  assert.deepEqual(metadata.warnings, []);
  assert.ok(metadata.counts['A+ Buy'] > 0, 'Fixture must exercise the signal path');
  assert.ok(metadata.counts['Bullish CHoCH warning'] > 0);
  assert.ok(metadata.counts['Bearish CHoCH warning'] > 0);
  assert.equal(metadata.counts['B Buy'], 0, 'Default minAligned=5 excludes B');
  const signals = ctx.plots['A+ Buy'].data.filter(p => p.value === true);
  for (let i=1;i<signals.length;i++) assert.ok((signals[i].time-signals[i-1].time)/300000 > 4);
  const tables = ctx.plots.__tables__.data.at(-1).value;
  assert.equal(tables[0].rows, 11);
  assert.equal(tables[0].cells[1][0].text, 'Monthly');
  assert.equal(tables[0].cells[6][0].text, 'Execution');
});

test('price-mirrored multi-timeframe fixture exercises the sell path', async () => {
  const mirrored = { ...provider, symbol:'SIMULATED:INVERSE',
    async getMarketData(...args) {
      const rows = await provider.getMarketData(...args);
      return rows.map(c => ({ ...c, open:2000-c.open, close:2000-c.close, high:2000-c.low, low:2000-c.high }));
    },
  };
  const { metadata } = await runIndicator({ provider:mirrored });
  assert.deepEqual(metadata.warnings, []);
  assert.ok(metadata.counts['A+ Sell'] > 0, 'Fixture must exercise the sell path');
  assert.equal(metadata.counts['A+ Buy'], 0);
});

test('the active chart-timeframe guard rejects a 1H chart', async () => {
  await assert.rejects(runIndicator({ provider, timeframe:'60', bars:100 }), /below 1H/);
});

test('display input overrides suppress midpoint and CHoCH plots', async () => {
  const { ctx, metadata } = await runIndicator({ provider, inputs:{
    'Show 4H midpoint':false, 'Show Execution CHoCH warnings':false, 'Show six-tier dashboard':false,
  }});
  assert.deepEqual(metadata.warnings, []);
  assert.equal(metadata.counts['Bullish CHoCH warning'], 0);
  assert.equal(metadata.counts['Bearish CHoCH warning'], 0);
  assert.ok(ctx.plots['4H protected range midpoint'].data.every(p => Number.isNaN(p.value)));
});

test('legacy audit retains every A+ label without inventing a trade outcome', async()=>{
  const result=await runIndicator({provider,auditContext:true});
  const catalog=buildLegacyCatalog(result);
  assert.equal(catalog.counts.legacyAPlus,result.metadata.counts['A+ Buy']+result.metadata.counts['A+ Sell']);
  assert.ok(catalog.records.length>0);
  assert.equal(catalog.counts.tradeOutcomesDefined,0);
  for(const record of catalog.records) {
    for(const key of ['entry','stop','target','outcome','executionQualification']) assert.equal(record[key],null);
    const direction=record.direction==='long'?1:-1;
    assert.ok(Object.values(record.tiers).every(tier=>tier.trend===direction));
    for(const observation of Object.values(record.observations)) {
      if(observation) assert.ok(observation.confirmedAt<=record.signalConfirmedAt,'Catalog must not observe future bars');
    }
  }
});
