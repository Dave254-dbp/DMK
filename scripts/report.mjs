const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function renderReport(candles, plots, metadata) {
  const w = 1200, h = 520, left = 70, right = 30, top = 100, bottom = 70;
  const minimum = Math.min(...candles.map(c => c.low));
  const maximum = Math.max(...candles.map(c => c.high));
  const start = candles[0].openTime, end = candles.at(-1).openTime;
  const x = t => left + (t - start) / Math.max(1, end - start) * (w - left - right);
  const y = p => top + (maximum - p) / Math.max(.01, maximum - minimum) * (h - top - bottom);
  const line = candles.map(c => `${x(c.openTime).toFixed(2)},${y(c.close).toFixed(2)}`).join(' ');
  const byTime = new Map(candles.map(c => [c.openTime, c]));
  const signals = Object.keys(metadata.counts).filter(name => !name.includes('warning'));
  const markers = signals.flatMap(name => plots[name].data
    .filter(p => p.value === true || p.value === 1)
    .map(p => {
      const candle = byTime.get(p.time);
      if (!candle) return '';
      const buy = name.endsWith('Buy');
      return `<circle cx="${x(p.time)}" cy="${y(candle.close)}" r="4" fill="${buy ? '#16a34a' : '#dc2626'}"><title>${escape(name)} · ${new Date(p.time).toISOString()}</title></circle>`;
    })).join('');
  const grid = Array.from({length:5},(_,i)=>{
    const price=minimum+(maximum-minimum)*i/4;
    return `<line x1="${left}" x2="${w-right}" y1="${y(price)}" y2="${y(price)}" stroke="#e2e8f0"/><text x="${left-10}" y="${y(price)+4}" text-anchor="end" font-size="12">${price.toFixed(2)}</text>`;
  }).join('');
  const dates = Array.from({length:5},(_,i)=>{
    const time=start+(end-start)*i/4;
    return `<text x="${x(time)}" y="${h-bottom+28}" text-anchor="middle" font-size="12">${new Date(time).toISOString().slice(0,16).replace('T',' ')}</text>`;
  }).join('');
  const buys=signals.filter(n=>n.endsWith('Buy')).reduce((s,n)=>s+metadata.counts[n],0);
  const sells=signals.filter(n=>n.endsWith('Sell')).reduce((s,n)=>s+metadata.counts[n],0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="white"/>
  <g font-family="sans-serif" fill="#0f172a">
  <text x="${left}" y="32" font-size="22" font-weight="bold">DMK v0.3 · ${escape(metadata.symbol)} · ${metadata.timeframe}-minute bars</text>
  <text x="${left}" y="57" font-size="14">${escape(metadata.data)} · ${escape(metadata.runtime)}</text>
  <text x="${left}" y="79" font-size="13" fill="#475569">${metadata.bars} bars · ${buys} buys (green), ${sells} sells (red) · TradingView validation pending</text>
  ${grid}<polyline points="${line}" stroke="#2563eb" stroke-width="1.4" fill="none"/>${markers}${dates}
  <text x="${left}" y="${h-12}" font-size="12" fill="#475569">Times in UTC. Hover a signal marker for its grade and time. This run does not measure trading returns.</text>
  </g></svg>\n`;
}
