import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataProvider } from '../scripts/runtime.mjs';

test('provided EUR/USD metadata retains its precision and session rather than crypto defaults', async () => {
  const bar = { openTime:1704067200000,closeTime:1704068100000,
    open:1.1,high:1.101,low:1.099,close:1.1005,volume:100 };
  const provider = createDataProvider({'15':[bar]},'OANDA:EURUSD','Provided OANDA candles',{
    mintick:.00001,pricescale:100000,type:'forex',timezone:'America/New_York',session:'24x5',
  });
  const info = await provider.getSymbolInfo();
  assert.equal(info.mintick,.00001);
  assert.equal(info.type,'forex');
  assert.equal(info.session,'24x5');
  assert.equal(info.timezone,'America/New_York');
  assert.deepEqual(await provider.getMarketData('EURUSD','15'),[bar]);
});
