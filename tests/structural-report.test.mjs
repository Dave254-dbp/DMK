import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { renderStructuralReport } from '../scripts/structural-report.mjs';

const minute = 60_000;
const origin = Date.UTC(2026, 9, 1);
const candles = Array.from({ length: 8 }, (_, index) => ({
  openTime: origin + index * minute, closeTime: origin + (index + 1) * minute,
  open: 1.1, high: 1.11, low: 1.09, close: 1.105,
}));
const base = {
  grade: 'A+', direction: 'long', entry: 1.1, stop: 1.09,
  target: { name: 'Previous day high', price: 1.12, knownAt: origin },
  knownAt: origin + minute, risk: 0.01, riskPriceDistance: 0.01,
  tickSize: 0.00001, riskPoints: 1000, pipSize: 0.0001, riskPips: 100,
  riskPercent: 0.90909, targetRR: 2,
  score: { alignedTiers: 6 }, qualificationEvidence: { sweep: { confirmedAt: origin }, mss: { confirmed: true }, fvg: { entryConvention: 'Midpoint' } },
  notes: ['Prices are fixed at qualification.'], maxRLower: 2, maxRUpper: 2, maxRExact: true,
};
const records = [
  { ...base, id: 'Winner', triggered: true, outcome: 'WIN', entryTime: origin + minute,
    entryTimeFrom: origin + minute, entryTimeTo: origin + minute,
    outcomeTimeFrom: origin + 2 * minute, outcomeTimeTo: origin + 3 * minute, targetReached: 'Previous day high' },
  { ...base, id: 'Loss with interval', triggered: true, outcome: 'LOSS', entryTime: null,
    entryTimeFrom: origin + 2 * minute, entryTimeTo: origin + 3 * minute,
    outcomeTimeFrom: origin + 4 * minute, outcomeTimeTo: origin + 5 * minute,
    maxRLower: 0.3, maxRUpper: 1.2, maxRExact: false },
  { ...base, id: 'Waiting B', grade: 'B', triggered: false, outcome: 'NOT_TRIGGERED',
    maxRLower: null, maxRUpper: null, maxRExact: false },
  { ...base, id: 'Ambiguous retest', triggered: null, outcome: 'AMBIGUOUS',
    entryTime: null, entryTimeFrom: origin + minute, entryTimeTo: origin + 2 * minute,
    maxRLower: 0, maxRUpper: 2, maxRExact: false },
];
const summary = { total: 4, triggered: 2, untriggered: 1, ambiguousEntry: 1,
  WIN: 1, LOSS: 1, BE: 0, INVALIDATED: 0, NOT_TRIGGERED: 1, OPEN: 0, AMBIGUOUS: 1,
  byGrade: { 'A+': { total: 3, triggered: 2, WIN: 1, LOSS: 1, BE: 0, INVALIDATED: 0, NOT_TRIGGERED: 0, OPEN: 0, AMBIGUOUS: 1 },
    B: { total: 1, triggered: 0, WIN: 0, LOSS: 0, BE: 0, INVALIDATED: 0, NOT_TRIGGERED: 1, OPEN: 0, AMBIGUOUS: 0 } } };
const legacyAudit = { records: [{ id: 'Old label', direction: 'long', signalConfirmedAt: origin,
  executionQualification: { qualified: false, linkedSetupId: 'Winner', linkKind: 'PRIOR_STRUCTURAL_SEQUENCE', reasonCodes: ['NO_NEW_SETUP_ON_SIGNAL'] },
  reason: 'Prior alignment signal; no new retest sequence.', tiers: { M: { trend: 1 } }, outcome: null }] };
const metadata = { symbol: 'OANDA:EURUSD', timeframe: '15', description: 'Synthetic report fixture only',
  runtime: 'Test fixture', sourceSha: 'fixture-source-sha', warnings: ['Synthetic report fixture, not a EURUSD performance result.'] };
const fixture = { candles, records, summary, legacyAudit, metadata, settings: { entryConvention: 'FVG midpoint', includeRReferences: false } };

function embedded(html) {
  return JSON.parse(html.match(/<script id="audit-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
}

// Exercise the generated client without introducing a browser dependency.
// This small DOM double checks actual text, attributes and event handlers.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this._text = ''; this.value = ''; this.hidden = false; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get firstChild() { return this.children[0]; }
  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
  dispatch(name) { this.events[name]?.(); }
}

function mount(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element('div'));
  elements.get('audit-data').textContent = JSON.stringify(embedded(html));
  const document = {
    getElementById: id => elements.get(id), createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
  };
  const client = html.match(/<script>\(([\s\S]*?)\)\(\);<\/script>/)[1];
  vm.runInNewContext(`(${client})();`, { document, Node: Element }, { timeout: 1000 });
  return { get: id => elements.get(id) };
}

test('report preserves all structural and legacy records independently without external resources', () => {
  const html = renderStructuralReport(fixture), data = embedded(html);
  assert.deepEqual(data.records, records);
  assert.deepEqual(data.legacyAudit, legacyAudit);
  assert.deepEqual(data.summary, summary);
  assert.doesNotMatch(html, /<(?:script|link|img|iframe)[^>]+(?:src|href)\s*=/i);
  assert.match(html, /fixture-source-sha/);
  assert.match(html, /Synthetic report fixture only/);
  assert.match(html, /spread, fees and slippage are not modeled/);
  assert.match(html, /candle interval is shown/);
});

test('script terminators and HTML in metadata or evidence remain inert text', () => {
  const attack = '</script><img src=x onerror="alert(1)">&\u2028\u2029';
  const html = renderStructuralReport({ ...fixture,
    metadata: { ...metadata, description: attack, sourceSha: attack },
    records: [{ ...records[0], id: attack, qualificationEvidence: { finding: attack } }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /\\u2028\\u2029/);
  assert.equal(embedded(html).records[0].qualificationEvidence.finding, attack);
  const dom = mount(html);
  assert.match(dom.get('selected-title').textContent, /<img src=x/);
  assert.match(dom.get('selected-evidence').textContent, /<img src=x/);
  assert.equal(dom.get('selected-evidence').children.some(child => child.tagName === 'img'), false);
});

test('selected record displays exact known timing, liquidity target, risk units and distinct R references', () => {
  const dom = mount(renderStructuralReport(fixture));
  const facts = dom.get('selected-facts').textContent;
  assert.match(facts, /2026-10-01 00:01:00 UTC \(exact\)/);
  assert.match(facts, /Previous day high · 1.12/);
  assert.match(facts, /2 R:R/);
  assert.match(facts, /Risk in points \/ ticks1000/);
  assert.match(facts, /Risk in pips100/);
  assert.match(facts, /0.9091% of entry quote/);
  assert.match(dom.get('chart').textContent, /Previous day high TP 1.12/);
  assert.doesNotMatch(dom.get('chart').textContent, /1R reference/);
  dom.get('r-references').checked = true; dom.get('r-references').dispatch('change');
  assert.match(dom.get('chart').textContent, /1R reference 1.11/);
  assert.match(dom.get('chart').textContent, /2R reference 1.12/);
  assert.match(dom.get('chart').textContent, /3R reference 1.13/);
  assert.equal(dom.get('chart').children[0].attributes.role, 'img');
});

test('outcome and grade filters preserve truthful interval and pending-entry behavior', () => {
  const dom = mount(renderStructuralReport(fixture));
  dom.get('outcome-filter').value = 'LOSS'; dom.get('outcome-filter').dispatch('change');
  assert.equal(dom.get('visible-count').textContent, '1 of 4 setups shown');
  assert.match(dom.get('selected-facts').textContent, /00:02:00 UTC – 2026-10-01 00:03:00 UTC \(candle interval\)/);
  assert.match(dom.get('selected-facts').textContent, /0.3–1.2R \(bounds\)/);
  dom.get('outcome-filter').value = ''; dom.get('grade-filter').value = 'B'; dom.get('grade-filter').dispatch('change');
  assert.equal(dom.get('visible-count').textContent, '1 of 4 setups shown');
  assert.match(dom.get('selected-title').textContent, /Waiting B/);
  assert.match(dom.get('selected-facts').textContent, /Entry timingNo established entry/);
  dom.get('outcome-filter').value = 'WIN'; dom.get('outcome-filter').dispatch('change');
  assert.equal(dom.get('selected-card').hidden, true);
  assert.match(dom.get('records-table').textContent, /No setups match/);
});

test('legacy label tab displays qualification findings without assigning linked trade outcome', () => {
  const dom = mount(renderStructuralReport(fixture));
  dom.get('legacy-tab').dispatch('click');
  assert.equal(dom.get('legacy-panel').hidden, false);
  assert.equal(dom.get('setups-panel').hidden, true);
  assert.match(dom.get('legacy-count').textContent, /1 original A\+ labels retained/);
  assert.match(dom.get('legacy-table').textContent, /No new structural setup qualified/);
  assert.doesNotMatch(dom.get('legacy-table').textContent, /WIN/);
  const button = dom.get('legacy-table').children[0].children[1].children[0].children[0].children[0];
  button.dispatch('click');
  assert.equal(dom.get('legacy-detail').hidden, false);
  assert.match(dom.get('legacy-facts').textContent, /Not assigned from original qualification label/);
  assert.match(dom.get('legacy-evidence').textContent, /NO_NEW_SETUP_ON_SIGNAL/);
});

test('empty reports do not invent counts or setup details', () => {
  const dom = mount(renderStructuralReport());
  assert.match(dom.get('records-table').textContent, /No structural setups supplied/);
  assert.equal(dom.get('selected-card').hidden, true);
  assert.match(dom.get('legacy-table').textContent, /No original A\+ label catalog/);
  assert.match(dom.get('metrics').textContent, /—Triggered entries/);
});

test('runtime provenance, detector assumptions and bar-count expiry remain visible', () => {
  const hash = 'abcdef-source-sha256';
  const html = renderStructuralReport({ ...fixture,
    records: [{ ...records[0], expiresAfterBars: 24, pendingEvaluatedBars: 7 }],
    metadata: { ...metadata, sourceSha: undefined, sourceSha256: hash,
      auditSourceHashes: { 'structural-setups.mjs': 'detector-hash', 'setup-audit.mjs': 'outcome-hash' },
      assumptions: ['MSS is confirmed only after the sweep.'], diagnostics: ['Native daily history is missing.'] },
  });
  assert.match(html, /Pine source SHA: abcdef-source-sha256/);
  assert.match(html, /structural-setups.mjs SHA: detector-hash/);
  assert.match(html, /setup-audit.mjs SHA: outcome-hash/);
  const dom = mount(html);
  assert.match(dom.get('assumptions').textContent, /MSS is confirmed only after the sweep/);
  assert.match(dom.get('warnings').textContent, /Native daily history is missing/);
  assert.match(dom.get('selected-facts').textContent, /Pending entry expiry24 eligible future chart bars/);
  assert.match(dom.get('selected-facts').textContent, /Pending bars evaluated7/);
  assert.match(dom.get('chart').textContent, /WIN interval/);
});
