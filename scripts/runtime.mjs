import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PineTS, Indicator } from 'pinets';

export const indicatorPath = new URL('../DMK.pine', import.meta.url);
export const executionIndicatorPath = new URL('../DMK-execution.pine', import.meta.url);
const canonical = (tf) => ({ '1M': 'M', '1W': 'W', '1D': 'D' }[tf] ?? tf);
const minute = 60_000;

// All six fixture tiers aggregate the same 5-minute candles, including calendar
// months and Monday-based weeks. Prices are simulated, never downloaded quotes.
export function createSyntheticProvider() {
  const history = new Map(['5', '60', '240', 'D', 'W', 'M'].map(tf => [tf, []]));
  const end = Date.UTC(2026, 0, 15);
  const start = Date.UTC(2018, 0, 1);
  const day = 1440 * minute;
  const price = (t) => {
    const d = (t - start) / day;
    return 500 + .08 * d + 60 * Math.sin(2 * Math.PI * d / 540)
      + 10 * Math.sin(2 * Math.PI * d / 45)
      + 2 * Math.sin(2 * Math.PI * d / 2.5)
      + Math.sin(2 * Math.PI * d / .12);
  };
  function period(tf, t) {
    if (tf === 'M') {
      const date = new Date(t);
      return [Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)];
    }
    const duration = (tf === 'W' ? 10080 : tf === 'D' ? 1440 : Number(tf)) * minute;
    const offset = tf === 'W' ? Date.UTC(1970, 0, 5) : 0;
    const open = Math.floor((t - offset) / duration) * duration + offset;
    return [open, open + duration];
  }
  for (let t = start; t < end; t += 5 * minute) {
    const open = price(t), close = price(t + 5 * minute);
    const high = Math.max(open, close) + .12;
    const low = Math.min(open, close) - .12;
    for (const [tf, rows] of history) {
      const [openTime, closeTime] = period(tf, t);
      const last = rows.at(-1);
      if (last?.openTime === openTime) {
        last.high = Math.max(last.high, high);
        last.low = Math.min(last.low, low);
        last.close = close;
        last.volume += 100;
      } else {
        rows.push({ openTime, closeTime, open, high, low, close, volume: 100 });
        // Trim in batches, keeping ample native history for pivot warm-up.
        const keep = tf === '5' ? 6000 : 600;
        if (rows.length > keep * 2) rows.splice(0, rows.length - keep);
      }
    }
  }
  for (const [tf, rows] of history) {
    history.set(tf, rows.slice(-(tf === '5' ? 6000 : 600)));
  }
  return createDataProvider(Object.fromEntries(history), 'SIMULATED:DMK', 'Synthetic, coherently aggregated candles; not market data',
    {mintick:0.01,pricescale:100,type:'crypto',timezone:'Etc/UTC',session:'24x7'});
}

export function createDataProvider(timeframes, symbol, description = 'User-supplied OHLCV', symbolInfo = {}) {
  const series = new Map(Object.entries(timeframes).map(([tf, rows]) => [canonical(tf), rows]));
  for (const [tf, rows] of series) {
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Empty timeframe ${tf}`);
    let previous = -Infinity;
    for (const row of rows) {
      if (!['openTime', 'closeTime', 'open', 'high', 'low', 'close', 'volume'].every(key => Number.isFinite(row[key]))
          || row.openTime <= previous || row.closeTime <= row.openTime
          || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)
          || row.volume < 0) throw new Error(`Invalid or unordered candle in ${tf}`);
      previous = row.openTime;
    }
  }
  return {
    symbol, description, timeframes: [...series.keys()], suppliedSymbolInfo: {...symbolInfo}, configure() {},
    async getMarketData(_symbol, tf, limit, _start, finish) {
      const rows = series.get(canonical(tf));
      if (!rows) throw new Error(`Missing ${tf} data: supply all six native timeframes`);
      // Retain native warm-up before chart start. Exclude bars opening after
      // the requested end; a provider must never manufacture future history.
      const available = finish == null ? rows : rows.filter(row => row.openTime <= finish);
      return limit ? available.slice(-limit) : available;
    },
    async getSymbolInfo() {
      return { tickerid: symbol, main_tickerid: symbol, ticker: symbol.split(':').at(-1),
        description, timezone: 'Etc/UTC', session: '24x7', mintick: .01,
        pricescale: 100, type: 'crypto', prefix: symbol.split(':')[0], ...symbolInfo };
    },
  };
}

export function instrumentAuditContext(source) {
  // These observations expose existing series without replacing the original
  // signal formulas. All history offsets refer to completed earlier bars.
  const fields = {
    'Trend M':'trendM', 'Trend W':'trendW', 'Trend D':'trendD',
    'Trend 4H':'trend4H', 'Trend 1H':'trend1H', 'Trend E':'trendE',
    'Event E':'eventE', 'Direction E':'directionE',
    'Prior protected high':'highE[1]', 'Prior protected low':'lowE[1]',
    'Protected high':'highE', 'Protected low':'lowE',
    'Confirmed pivot high':'ta.pivothigh(high, swingLen, swingLen)',
    'Confirmed pivot low':'ta.pivotlow(low, swingLen, swingLen)',
  };
  for (const tier of ['M','W','D','4H','1H','E']) {
    fields[`Pending up ${tier}`] = `pendingUp${tier} ? 1 : 0`;
    fields[`Pending down ${tier}`] = `pendingDown${tier} ? 1 : 0`;
  }
  return source + '\n// Audit observations; qualification is separate from execution.\n'
    + Object.entries(fields).map(([name,expression]) =>
      `plot(${expression}, "Audit ${name}", display=display.data_window)`).join('\n') + '\n';
}

export async function runIndicator({ provider = createSyntheticProvider(), timeframe = '5', bars = 3000, inputs = {}, auditContext = false, sourcePath = indicatorPath } = {}) {
  if (!Number.isSafeInteger(bars) || bars < 1) throw new Error('bars must be a positive safe integer');
  const source = await readFile(sourcePath, 'utf8');
  const runner = new PineTS(provider, provider.symbol, timeframe, bars);
  runner.setMaxLoops(1000);
  const ctx = await runner.run(new Indicator(auditContext ? instrumentAuditContext(source) : source, inputs));
  const candles = ctx.marketData;
  const symbolInfo = await provider.getSymbolInfo(provider.symbol);
  const executionSource=!!ctx.plots['A+ Limit Long'];
  const signalNames=executionSource?['A+ Limit Long','A Limit Long','B Limit Long',
    'A+ Limit Short','A Limit Short','B Limit Short']:
    ['A+ Buy', 'A Buy', 'B Buy', 'A+ Sell', 'A Sell', 'B Sell',
    'Bullish CHoCH warning', 'Bearish CHoCH warning'];
  const counts = Object.fromEntries(signalNames.map(name =>
    [name, (ctx.plots[name]?.data ?? []).filter(point => point.value === true || point.value === 1).length]));
  return { ctx, candles, metadata: { runtime: 'PineTS 0.11.0', sourceSha256: createHash('sha256').update(source).digest('hex'),
    data: provider.description, symbol: provider.symbol, timeframe, bars: candles.length, inputs, counts,
    countsMeaning:executionSource?'Qualified pending limit orders, not executed trades':'Alignment labels, not executed trades',
    symbolInfo,
    suppliedSymbolInfo: provider.suppliedSymbolInfo ?? null,
    warnings: ctx.warnings, tradingViewValidated: false } };
}
