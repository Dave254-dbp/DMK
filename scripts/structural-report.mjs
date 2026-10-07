const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// JSON lives in an inert script element. Escaping '<' also prevents user text
// such as '</script>' from terminating that element before JSON.parse runs.
const embedJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** A local, self-contained report. Supplied evidence is displayed, not certified. */
export function renderStructuralReport({ candles = [], records = [], summary = {},
  legacyAudit = {}, metadata = {}, settings = {} } = {}) {
  const data = {
    candles: Array.isArray(candles) ? candles : [],
    records: Array.isArray(records) ? records : [],
    summary: summary ?? {}, legacyAudit: legacyAudit ?? {},
    metadata: metadata ?? {}, settings: settings ?? {},
  };
  const description = metadata?.description ?? metadata?.data ?? 'Data source not supplied';
  const timeframe = metadata?.timeframe == null ? null : String(metadata.timeframe);
  const subtitle = [metadata?.symbol ?? 'Symbol not supplied',
    timeframe ? (/^\d+$/.test(timeframe) ? `${timeframe}-minute bars` : `${timeframe} timeframe`) : 'Timeframe not supplied', description].join(' · ');
  const auditHashes = Object.entries(metadata?.auditSourceHashes ?? {}).map(([name, hash]) =>
    `<p class="small muted source">${escapeHTML(name)} SHA: ${escapeHTML(hash)}</p>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DMK structural setup audit</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#566176;--line:#dce2ec;--green:#087b54;--red:#bf2840;--blue:#225ccb}
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1500px;margin:auto;padding:24px}h1{font-size:28px;line-height:1.2;margin:0 0 9px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:20px 0 9px}p{margin:8px 0}.muted{color:var(--muted)}.small{font-size:13px}.source{overflow-wrap:anywhere}.notice{background:#fff5da;border:1px solid #ead492;border-radius:8px;padding:12px 16px;margin:16px 0}.card{background:white;border:1px solid var(--line);border-radius:10px;padding:18px;margin-top:16px;min-width:0}.tabs,.controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.tabs{margin-top:20px}button,select{font:inherit;color:inherit;border:1px solid #bac4d3;background:#fff;border-radius:6px;padding:7px 11px;cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #a2c1ff;outline-offset:2px}.tabs button[aria-selected=true]{color:#fff;background:#244da0;border-color:#244da0}.controls label{display:flex;align-items:center;gap:8px}.controls select{max-width:220px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.metric{background:#f6f8fc;border-radius:7px;padding:10px 12px}.metric strong{display:block;font-size:25px}.table-scroll{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:7px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}th{background:#f3f6fa;font-weight:600;white-space:nowrap}tbody tr:last-child td{border-bottom:0}tbody tr.selected{background:#eef4ff}.record-button{border:0;background:none;padding:0;color:var(--blue);font-weight:600;text-align:left;overflow-wrap:anywhere;max-width:230px}.nowrap{white-space:nowrap}.badge{display:inline-block;padding:2px 6px;border-radius:4px;background:#edf0f6;white-space:nowrap;font-size:12px;font-weight:650}.badge.WIN{background:#dcf4e8;color:#075c3e}.badge.LOSS,.badge.INVALIDATED{background:#ffe5e9;color:#972039}.badge.AMBIGUOUS{background:#fff1cb;color:#755200}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.fact{background:#f6f8fc;border-radius:6px;padding:10px 12px;overflow-wrap:anywhere}.fact dt{font-size:12px;color:var(--muted)}.fact dd{margin:3px 0 0;font-weight:550;white-space:pre-line}.evidence{list-style:none;margin:0;padding:0}.evidence li{border-bottom:1px solid #edf0f4;padding:6px 0;overflow-wrap:anywhere}.evidence li:last-child{border:0}.evidence-key{color:var(--muted);margin-right:7px}.chart-scroll{overflow:auto;border:1px solid var(--line);border-radius:7px;margin-top:12px}.chart-scroll svg{display:block;max-width:none}.empty{padding:24px;text-align:center;color:var(--muted)}.legend{display:flex;gap:15px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.swatch{display:inline-block;width:18px;border-top:3px solid;vertical-align:middle;margin-right:5px}.footnote{margin-top:24px;color:var(--muted);font-size:12px}[hidden]{display:none!important}
@media(max-width:600px){main{padding:14px}h1{font-size:23px}.card{padding:12px}th,td{padding:8px}.controls{align-items:flex-start}.controls label{flex-wrap:wrap}}
</style></head><body><main>
<header><h1>DMK structural setup audit</h1><p class="source">${escapeHTML(subtitle)}</p>
<p class="small muted source">Runtime: ${escapeHTML(metadata?.runtime ?? 'Not supplied')} · Pine source SHA: ${escapeHTML(metadata?.sourceSha256 ?? metadata?.sourceSha ?? 'Not supplied')}</p>${auditHashes}</header>
<div class="notice">OHLC audit: spread, fees and slippage are not modeled. A setup qualifying as A+ or B does not establish a winning trade. When candle data cannot establish event order, the result remains ambiguous. Times use UTC; a candle interval is shown when the exact retest time is unavailable.</div>
<div id="warnings" class="small muted"></div>
<details class="card"><summary>Audit assumptions and data limits</summary><ul id="assumptions" class="evidence"></ul></details>
<nav class="tabs" aria-label="Audit populations"><button id="setups-tab" type="button" aria-selected="true" aria-controls="setups-panel">Structural setups</button><button id="legacy-tab" type="button" aria-selected="false" aria-controls="legacy-panel">Original A+ labels</button></nav>
<section id="setups-panel"><div class="card"><h2>Qualification and trade outcomes</h2><div id="metrics" class="metrics"></div><p class="small muted">All supplied setups are retained, including overlaps. Triggered means an entry was established; ambiguous entry order is counted separately. Not triggered includes expired orders and orders still waiting when history ends.</p><div id="grade-summary" class="table-scroll"></div></div>
<div class="card"><div class="controls"><label>Grade <select id="grade-filter" aria-label="Filter setup grade"></select></label><label>Outcome <select id="outcome-filter" aria-label="Filter setup outcome"></select></label><span id="visible-count" class="small muted"></span></div><p class="small muted">Select a setup to inspect its fixed levels, timing and qualification evidence.</p><div id="records-table" class="table-scroll"></div></div>
<section id="selected-card" class="card"><h2 id="selected-title">Setup details</h2><div id="selected-facts" class="facts"></div><div class="controls" style="margin-top:16px"><label><input id="r-references" type="checkbox"> Show 1R, 2R and 3R reference levels</label></div><p class="small muted">Entry, structural stop and liquidity target are fixed at qualification. R reference levels are informational; the named liquidity target determines the modeled profit exit.</p><div class="legend"><span><i class="swatch" style="color:#225ccb"></i>Entry</span><span><i class="swatch" style="color:#bf2840"></i>Structural SL</span><span><i class="swatch" style="color:#087b54"></i>Liquidity TP</span><span><i class="swatch" style="color:#ab7908"></i>Entry time / interval</span></div><div id="chart" class="chart-scroll"></div><p id="chart-caption" class="small muted"></p><h3>Qualification evidence and score</h3><ul id="selected-evidence" class="evidence"></ul><h3>Audit notes</h3><ul id="selected-notes" class="evidence"></ul></section></section>
<section id="legacy-panel" hidden><div class="card"><h2>Original A+ label population</h2><p>These labels record the original six-tier qualification. A missing structural entry sequence is a qualification finding, not a losing trade. Original labels remain separate from the structural setup outcome counts.</p><p id="legacy-count" class="small muted"></p><div id="legacy-table" class="table-scroll"></div></div><section id="legacy-detail" class="card" hidden><h2 id="legacy-title">Original label details</h2><div id="legacy-facts" class="facts"></div><h3>Qualification findings</h3><ul id="legacy-evidence" class="evidence"></ul></section></section>
<details class="card"><summary>Rules used for this audit</summary><ul id="rules" class="evidence"></ul></details>
<p class="footnote">Risk percentage is the stop distance as a percentage of entry price, not the percentage of account capital at risk. Maximum R describes favorable movement before the modeled exit, with bounds when candle order is unknown. Local report; no network resources are loaded.</p>
</main><script id="audit-data" type="application/json">${embedJSON(data)}</script>
<script>(${initializeReport.toString()})();</script></body></html>\n`;
}

function initializeReport() {
  const data = JSON.parse(document.getElementById('audit-data').textContent);
  const records = data.records;
  const candles = [...data.candles].sort((a, b) => a.openTime - b.openTime);
  const legacy = Array.isArray(data.legacyAudit.records) ? data.legacyAudit.records : [];
  const $ = id => document.getElementById(id);
  const node = (tag, value, className) => {
    const element = document.createElement(tag);
    if (value != null) element.textContent = String(value);
    if (className) element.className = className;
    return element;
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, places = 5) => finite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: places, useGrouping: false }) : 'Not supplied';
  const utc = value => {
    if (!finite(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}` : null;
  };
  const timing = (exact, from, to, empty = 'Not established') => {
    if (utc(exact)) return `${utc(exact)} (exact)`;
    if (utc(from) && utc(to)) return from === to ? `${utc(from)} (exact)` : `${utc(from)} – ${utc(to)} (candle interval)`;
    return empty;
  };
  const outcome = record => String(record.outcome ?? 'Not defined').replaceAll('_', ' ');
  const badge = record => node('span', outcome(record), `badge ${['WIN', 'LOSS', 'INVALIDATED', 'AMBIGUOUS'].includes(record.outcome) ? record.outcome : ''}`);
  const price = (value, record) => number(value, Math.min(10, Math.max(5,
    finite(record?.tickSize) && record.tickSize < 1 ? Math.ceil(-Math.log10(record.tickSize)) : 5)));
  const mfe = record => {
    if (!finite(record.maxRLower) || !finite(record.maxRUpper)) return 'Not established';
    return record.maxRExact || Math.abs(record.maxRLower - record.maxRUpper) < 1e-12
      ? `${number(record.maxRLower, 3)}R` : `${number(record.maxRLower, 3)}–${number(record.maxRUpper, 3)}R (bounds)`;
  };
  const table = headings => {
    const element = node('table');
    const head = node('thead'), row = node('tr'), body = node('tbody');
    for (const heading of headings) row.append(node('th', heading));
    head.append(row); element.append(head, body);
    return { element, body };
  };
  const cell = (row, value, className) => {
    const element = node('td', value instanceof Node ? null : value, className);
    if (value instanceof Node) element.append(value);
    row.append(element); return element;
  };
  const fact = (container, name, value) => {
    const element = node('dl', null, 'fact');
    element.append(node('dt', name), node('dd', value)); container.append(element);
  };
  const readable = text => String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
  const evidence = (container, value, prefix = '', depth = 0) => {
    if (value != null && typeof value === 'object' && depth < 12) {
      const entries = Array.isArray(value) ? value.map((item, index) => [index + 1, item]) : Object.entries(value);
      if (!entries.length) return;
      for (const [key, child] of entries) evidence(container, child, prefix ? `${prefix} › ${readable(key)}` : readable(key), depth + 1);
      return;
    }
    const item = node('li');
    if (prefix) item.append(node('span', `${prefix}:`, 'evidence-key'));
    const displayed = value == null ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value)
      : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
    item.append(node('span', displayed)); container.append(item);
  };
  const empty = (container, message) => container.replaceChildren(node('div', message, 'empty'));
  const counts = data.summary;
  const metricPairs = [['Setups', counts.total ?? records.length], ['Triggered entries', counts.triggered],
    ['Wins', counts.WIN], ['Losses', counts.LOSS], ['Breakeven', counts.BE ?? counts.BREAKEVEN],
    ['Invalidated before entry', counts.INVALIDATED], ['Not triggered', counts.NOT_TRIGGERED],
    ['Expired unfilled', counts.expiredBeforeEntry], ['Still waiting at history end', counts.pendingAtEnd],
    ['Open', counts.OPEN], ['Ambiguous outcome', counts.AMBIGUOUS], ['Ambiguous entry', counts.ambiguousEntry]];
  for (const [name, value] of metricPairs) {
    const metric = node('div', null, 'metric');
    metric.append(node('strong', finite(value) ? String(value) : '—'), node('span', name)); $('metrics').append(metric);
  }
  const grades = table(['Grade', 'Setups', 'Triggered', 'WIN', 'LOSS', 'BE', 'INVALIDATED', 'NOT TRIGGERED', 'OPEN', 'AMBIGUOUS']);
  for (const [grade, values] of Object.entries(counts.byGrade ?? {})) {
    const row = node('tr'); cell(row, grade);
    for (const key of ['total', 'triggered', 'WIN', 'LOSS', 'BE', 'INVALIDATED', 'NOT_TRIGGERED', 'OPEN', 'AMBIGUOUS']) cell(row, finite(values[key]) ? values[key] : '—');
    grades.body.append(row);
  }
  if (grades.body.childElementCount) $('grade-summary').append(grades.element);
  else empty($('grade-summary'), 'No grade summary supplied.');
  const warnings = data.metadata.warnings;
  if (Array.isArray(warnings)) for (const warning of warnings) $('warnings').append(node('p', typeof warning === 'string' ? warning : JSON.stringify(warning)));
  if (Array.isArray(data.metadata.diagnostics)) for (const diagnostic of data.metadata.diagnostics) $('warnings').append(node('p', typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic)));
  if (data.metadata.tradingViewValidated === false) $('warnings').append(node('p', 'This audit has not been validated in the official TradingView runtime.'));
  if (Array.isArray(data.metadata.assumptions) && data.metadata.assumptions.length) {
    for (const assumption of data.metadata.assumptions) evidence($('assumptions'), assumption);
  } else evidence($('assumptions'), 'No additional detection assumptions were supplied.');
  if (data.settings && Object.keys(data.settings).length) evidence($('rules'), data.settings);
  else evidence($('rules'), 'No detector or execution settings were supplied.');
  if (counts.options) evidence($('rules'), counts.options, 'Outcome rules');
  if (counts.sourceModel) evidence($('rules'), counts.sourceModel, 'Model');
  let selected = records[0] ?? null;
  const fillFilter = (id, values, label) => {
    $(id).append(node('option', label)); $(id).firstChild.value = '';
    for (const value of values) { const option = node('option', value); option.value = value; $(id).append(option); }
  };
  fillFilter('grade-filter', [...new Set(records.map(record => String(record.grade ?? 'Not supplied')))].sort(), 'All grades');
  fillFilter('outcome-filter', [...new Set(records.map(outcome))].sort(), 'All outcomes');
  $('r-references').checked = data.settings.includeRReferences === true || records.some(record => record.rReferences != null);
  function renderRecords() {
    const filtered = records.filter(record => (!$('grade-filter').value || String(record.grade ?? 'Not supplied') === $('grade-filter').value)
      && (!$('outcome-filter').value || outcome(record) === $('outcome-filter').value));
    $('visible-count').textContent = `${filtered.length} of ${records.length} setups shown`;
    if (!filtered.includes(selected)) selected = filtered[0] ?? null;
    const rows = table(['Setup', 'Grade / side', 'Entry level / timing', 'Structural SL', 'Liquidity TP / R:R', 'Outcome', 'Maximum R']);
    for (const record of filtered) {
      const row = node('tr');
      if (selected === record) row.className = 'selected';
      const button = node('button', record.id ?? 'Unnamed setup', 'record-button');
      button.type = 'button'; button.addEventListener('click', () => { selected = record; renderRecords(); });
      cell(row, button); cell(row, `${record.grade ?? 'Not supplied'} / ${record.direction ?? 'Not supplied'}`);
      const entryCell = cell(row, price(record.entry, record));
      entryCell.append(node('div', record.triggered === false ? 'No established entry' : timing(record.entryTime, record.entryTimeFrom, record.entryTimeTo), 'small muted'));
      cell(row, price(record.stop, record));
      const targetCell = cell(row, `${record.target?.name ?? 'Unnamed target'}: ${price(record.target?.price, record)}`);
      targetCell.append(node('div', `${number(record.targetRR, 3)} R:R`, 'small muted'));
      cell(row, badge(record)); cell(row, mfe(record)); rows.body.append(row);
    }
    if (filtered.length) $('records-table').replaceChildren(rows.element);
    else empty($('records-table'), records.length ? 'No setups match the selected filters.' : 'No structural setups supplied. No trade outcomes are inferred from original labels.');
    renderSelected();
  }
  function renderSelected() {
    $('selected-card').hidden = !selected;
    if (!selected) return;
    const record = selected;
    $('selected-title').textContent = `${record.id ?? 'Setup'} · ${record.grade ?? 'Unspecified grade'} · ${record.direction ?? 'Unspecified direction'}`;
    $('selected-facts').replaceChildren();
    const targetText = record.targetReached == null ? 'None established' : typeof record.targetReached === 'object' ? JSON.stringify(record.targetReached) : String(record.targetReached);
    const triggered = record.triggered === true ? 'Yes' : record.triggered === false ? 'No' : 'Unknown; event order is ambiguous';
    for (const [name, value] of [
      ['Outcome', outcome(record)], ['Entry established', triggered],
      ['Entry level', price(record.entry, record)], ['Entry timing', record.triggered === false ? 'No established entry' : timing(record.entryTime, record.entryTimeFrom, record.entryTimeTo)],
      ['Structural SL', price(record.stop, record)], ['Liquidity target', `${record.target?.name ?? 'Unnamed target'} · ${price(record.target?.price, record)}`],
      ['Active SL', price(record.activeStop ?? record.stop, record)],
      ['Structural R:R', `${number(record.targetRR, 3)} R:R`], ['Price risk distance', price(record.riskPriceDistance ?? record.risk, record)],
      ['Risk in points / ticks', finite(record.riskPoints) ? number(record.riskPoints, 3) : 'Unavailable without tick size'],
      ['Risk in pips', finite(record.riskPips) ? number(record.riskPips, 3) : 'Unavailable without pip size'],
      ['Price risk %', finite(record.riskPercent) ? `${number(record.riskPercent, 4)}% of entry quote` : 'Not supplied'],
      ['Maximum achieved R', mfe(record)], ['Target reached', targetText],
      ['Qualification confirmed', utc(record.knownAt) ?? 'Not supplied'], ['Outcome timing', timing(record.outcomeTime, record.outcomeTimeFrom, record.outcomeTimeTo)],
      ['Target known by', utc(record.target?.knownAt) ?? 'Not supplied'],
      ['Pending entry expiry', utc(record.expiresAt) ?? (finite(record.expiresAfterBars) ? `${record.expiresAfterBars} eligible future chart bars` : 'No supplied expiry')],
      ['Unfilled status', record.pendingAtEnd ? 'Still waiting at end of supplied history' : record.untriggeredReason === 'EXPIRED' ? 'Expired before entry' : '—'],
      ['Pending bars evaluated', finite(record.pendingEvaluatedBars) ? number(record.pendingEvaluatedBars, 0) : 'Not supplied'],
    ]) fact($('selected-facts'), name, value);
    $('selected-evidence').replaceChildren();
    if (record.score != null) evidence($('selected-evidence'), record.score, 'Score');
    if (record.qualificationEvidence != null) evidence($('selected-evidence'), record.qualificationEvidence);
    else evidence($('selected-evidence'), 'Qualification evidence was not supplied. An outcome does not certify structural qualification.');
    if (record.zone != null) evidence($('selected-evidence'), record.zone, 'Entry zone');
    $('selected-notes').replaceChildren();
    for (const note of record.notes ?? []) evidence($('selected-notes'), note);
    if (!$('selected-notes').childElementCount) evidence($('selected-notes'), 'No additional audit notes supplied.');
    drawChart(record);
  }
  const svgNode = (tag, attributes, text) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes ?? {})) element.setAttribute(key, String(value));
    if (text != null) element.textContent = String(text);
    return element;
  };
  function drawChart(record) {
    if (!candles.length) { empty($('chart'), 'No candles supplied for the chart.'); $('chart-caption').textContent = ''; return; }
    const anchor = record.knownAt ?? record.entryTimeFrom ?? candles[0].openTime;
    let first = candles.findIndex(candle => candle.closeTime >= anchor);
    if (first < 0) first = candles.length - 1;
    first = Math.max(0, first - 6);
    const finish = record.outcomeTimeTo ?? record.outcomeTime ?? candles.at(-1).closeTime;
    let last = candles.findIndex(candle => candle.openTime > finish);
    last = last < 0 ? candles.length : Math.min(candles.length, last + 6);
    const history = candles.slice(first, Math.max(first + 1, last));
    const width = Math.max(1000, history.length * 9 + 230), height = 420;
    const left = 108, right = 185, top = 28, bottom = 62;
    const refs = $('r-references').checked && finite(record.entry) && finite(record.riskPriceDistance ?? record.risk)
      ? Object.fromEntries([1, 2, 3].map(r => [`${r}R reference`, record.entry + (record.direction === 'short' ? -1 : 1) * r * (record.riskPriceDistance ?? record.risk)])) : {};
    const levels = [{ label: 'Entry', price: record.entry, color: '#225ccb' },
      { label: 'SL', price: record.stop, color: '#bf2840' },
      ...(finite(record.activeStop) && record.activeStop !== record.stop ? [{ label:'Active BE SL', price:record.activeStop, color:'#bd7620' }] : []),
      { label: `${record.target?.name ?? 'Liquidity'} TP`, price: record.target?.price, color: '#087b54' },
      ...Object.entries(refs).map(([label, reference]) => ({ label, price: reference, color: '#9b8aad', reference: true }))].filter(level => finite(level.price));
    let low = Infinity, high = -Infinity;
    for (const candle of history) { low = Math.min(low, candle.low); high = Math.max(high, candle.high); }
    for (const level of levels) { low = Math.min(low, level.price); high = Math.max(high, level.price); }
    const padding = Math.max((high - low) * 0.08, Math.abs(high) * 0.00005, 1e-10);
    low -= padding; high += padding;
    const y = value => top + (high - value) / (high - low) * (height - top - bottom);
    const start = history[0].openTime, end = history.at(-1).closeTime;
    const x = value => left + (value - start) / Math.max(1, end - start) * (width - left - right);
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Candlesticks and frozen setup entry, structural stop and liquidity target' });
    svg.append(svgNode('rect', { width, height, fill: '#fff' }));
    for (let index = 0; index <= 4; index++) {
      const value = low + (high - low) * index / 4;
      svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: '#e7ecf3' }),
        svgNode('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end', fill: '#566176', 'font-size': 12 }, price(value, record)));
    }
    const entryFrom = record.entryTimeFrom ?? record.entryTime;
    const entryTo = record.entryTimeTo ?? record.entryTime;
    if (finite(entryFrom) && finite(entryTo)) {
      const from = Math.max(left, x(entryFrom)), to = Math.min(width - right, x(entryTo));
      if (to > from) svg.append(svgNode('rect', { x: from, y: top, width: to - from, height: height - top - bottom, fill: '#d79f12', opacity: 0.14 }));
      svg.append(svgNode('line', { x1: from, x2: from, y1: top, y2: height - bottom, stroke: '#ab7908', 'stroke-dasharray': '4 4' }));
    }
    const outcomeFrom = record.outcomeTimeFrom ?? record.outcomeTime;
    const outcomeTo = record.outcomeTimeTo ?? record.outcomeTime;
    if (finite(outcomeFrom) && finite(outcomeTo)) {
      const from = Math.max(left, x(outcomeFrom)), to = Math.min(width - right, x(outcomeTo));
      if (to > from) svg.append(svgNode('rect', { x: from, y: top, width: to - from, height: height - top - bottom, fill: '#64748b', opacity: 0.1 }));
      svg.append(svgNode('line', { x1: from, x2: from, y1: top, y2: height - bottom, stroke: '#64748b', 'stroke-dasharray': '6 4' }),
        svgNode('text', { x: from + 4, y: height - bottom - 8, 'font-size': 11, fill: '#566176' }, `${outcome(record)} ${outcomeFrom === outcomeTo ? 'time' : 'interval'}`));
    }
    const bodyWidth = Math.max(3, Math.min(14, (width - left - right) / history.length * 0.65));
    for (const candle of history) {
      const cx = x((candle.openTime + candle.closeTime) / 2), color = candle.close >= candle.open ? '#168966' : '#ca4055';
      const group = svgNode('g');
      group.append(svgNode('title', {}, `${utc(candle.openTime)} – ${utc(candle.closeTime)}\nO ${price(candle.open, record)} · H ${price(candle.high, record)} · L ${price(candle.low, record)} · C ${price(candle.close, record)}`),
        svgNode('line', { x1: cx, x2: cx, y1: y(candle.high), y2: y(candle.low), stroke: color }),
        svgNode('rect', { x: cx - bodyWidth / 2, y: Math.min(y(candle.open), y(candle.close)), width: bodyWidth,
          height: Math.max(1, Math.abs(y(candle.open) - y(candle.close))), fill: color }));
      svg.append(group);
    }
    const knownX = Math.max(left, Math.min(width - right, x(anchor)));
    svg.append(svgNode('line', { x1: knownX, x2: knownX, y1: top, y2: height - bottom, stroke: '#64748b', 'stroke-dasharray': '2 5' }),
      svgNode('text', { x: knownX + 5, y: top + 12, 'font-size': 11, fill: '#566176' }, 'Setup confirmed'));
    for (const level of levels) {
      svg.append(svgNode('line', { x1: knownX, x2: width - right + 7, y1: y(level.price), y2: y(level.price), stroke: level.color,
        'stroke-width': level.reference ? 1 : 1.6, 'stroke-dasharray': level.reference ? '5 5' : '0' }),
      svgNode('text', { x: width - right + 13, y: y(level.price) - 4, 'font-size': 11, fill: level.color }, `${level.label} ${price(level.price, record)}`));
    }
    for (let index = 0; index <= 4; index++) {
      const time = start + (end - start) * index / 4;
      svg.append(svgNode('text', { x: x(time), y: height - bottom + 23, 'text-anchor': 'middle', fill: '#566176', 'font-size': 11 }, (utc(time) ?? '').slice(0, 16)));
    }
    svg.append(svgNode('text', { x: left, y: height - 13, 'font-size': 11, fill: '#566176' }, 'UTC · candle range audit · dashed R lines are references'));
    $('chart').replaceChildren(svg); $('chart').scrollLeft = 0;
    $('chart-caption').textContent = `${history.length} candles shown from ${utc(history[0].openTime)} to ${utc(history.at(-1).closeTime)}. Hover a candle for OHLC. Scroll horizontally for long setup windows. ${finite(entryFrom) ? `Entry ${record.triggered === null ? 'may occur within' : 'timing'}: ${timing(record.entryTime, entryFrom, entryTo)}.` : 'No established entry timestamp.'}`;
  }
  function renderLegacy() {
    $('legacy-count').textContent = `${legacy.length} original A+ labels retained. Their trade outcomes are not inferred or added to structural outcome counts.`;
    const rows = table(['Original label', 'Side / confirmed at', 'Structural qualification', 'Linked setup', 'Qualification finding']);
    for (const record of legacy) {
      const row = node('tr'), button = node('button', record.id ?? 'Original label', 'record-button');
      button.type = 'button'; button.addEventListener('click', () => showLegacy(record));
      cell(row, button); cell(row, `${record.direction ?? 'Unspecified'}\n${utc(record.signalConfirmedAt) ?? 'Timestamp not supplied'}`);
      const qualification = record.executionQualification;
      const qualified = typeof qualification === 'boolean' ? qualification : qualification?.qualified;
      cell(row, qualified === true ? 'New structural setup qualified on this bar' : qualified === false ? 'No new structural setup qualified on this bar' : 'Not evaluated');
      cell(row, qualification?.linkedSetupId ?? record.linkedSetupId ?? 'None established');
      cell(row, record.reason ?? (Array.isArray(qualification?.reasonCodes) ? qualification.reasonCodes.join(', ') : 'No qualification finding supplied'));
      rows.body.append(row);
    }
    if (legacy.length) $('legacy-table').replaceChildren(rows.element);
    else empty($('legacy-table'), 'No original A+ label catalog was supplied.');
  }
  function showLegacy(record) {
    $('legacy-detail').hidden = false; $('legacy-title').textContent = `${record.id ?? 'Original A+ label'} · qualification findings`;
    $('legacy-facts').replaceChildren();
    for (const [name, value] of [['Direction', record.direction ?? 'Not supplied'], ['Signal confirmed', utc(record.signalConfirmedAt) ?? 'Not supplied'],
      ['Execution event', record.executionEvent ?? 'Not supplied'], ['Trade outcome', 'Not assigned from original qualification label'],
      ['Linked structural setup', record.executionQualification?.linkedSetupId ?? record.linkedSetupId ?? 'None established']]) fact($('legacy-facts'), name, value);
    $('legacy-evidence').replaceChildren();
    evidence($('legacy-evidence'), record.reason ?? 'No finding supplied.', 'Finding');
    if (record.executionQualification != null) evidence($('legacy-evidence'), record.executionQualification, 'Structural qualification');
    if (record.qualificationEvidence != null) evidence($('legacy-evidence'), record.qualificationEvidence);
    if (record.tiers != null) evidence($('legacy-evidence'), record.tiers, 'Original six tiers');
    if (record.observations != null) evidence($('legacy-evidence'), record.observations, 'Observed by signal confirmation');
  }
  for (const id of ['grade-filter', 'outcome-filter']) $(id).addEventListener('change', renderRecords);
  $('r-references').addEventListener('change', () => { if (selected) drawChart(selected); });
  for (const tab of ['setups', 'legacy']) $(`${tab}-tab`).addEventListener('click', () => {
    for (const name of ['setups', 'legacy']) { $(`${name}-panel`).hidden = name !== tab; $(`${name}-tab`).setAttribute('aria-selected', String(name === tab)); }
  });
  renderRecords(); renderLegacy();
}
