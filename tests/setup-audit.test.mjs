import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSetups } from '../scripts/setup-audit.mjs';

const start=1704067200000, duration=900000;
const bar=(index,open,high,low,close=open)=>({openTime:start+index*duration,
  closeTime:start+(index+1)*duration,open,high,low,close,volume:100});
const setup=(overrides={})=>({id:'s1',grade:'A+',direction:'long',entry:100,stop:99,
  target:{price:103,name:'PDH',knownAt:start-duration},knownAt:start,...overrides});
const mirror=(candles)=>candles.map(c=>({...c,open:200-c.open,close:200-c.close,high:200-c.low,low:200-c.high}));

const cases=[
  ['entry at opening price then target', [bar(0,100,103.2,99.1,102)], 'WIN',true],
  ['entry at opening price then structural stop', [bar(0,100,100.8,98.9,99.5)], 'LOSS',true],
  ['both active exits in one candle', [bar(0,100,103.2,98.9,100.5)], 'AMBIGUOUS',true],
  ['entry and stop order unknown within candle', [bar(0,100.5,100.8,98.9,100.4)], 'AMBIGUOUS',null],
  ['entry and target order unknown within candle', [bar(0,100.5,103.2,99.5,101)], 'AMBIGUOUS',null],
  ['structural invalidation without entry', [bar(0,98.5,98.9,98,98.7)], 'INVALIDATED',false],
  ['liquidity taken without entry', [bar(0,101,103.2,100.4,102)], 'INVALIDATED',false],
  ['no retrace into entry', [bar(0,101,102,100.5,101.5)], 'NOT_TRIGGERED',false],
  ['triggered and still open', [bar(0,100,100.8,99.2,100.5)], 'OPEN',true],
  ['gap through active SL before later target', [bar(0,100,100.8,99.2,100.5),bar(1,98.5,104,98,103)], 'LOSS',true],
  ['gap through active target before later SL', [bar(0,100,100.8,99.2,100.5),bar(1,103.5,104,98,99)], 'WIN',true],
  ['opening invalidation is before later retest', [bar(0,98.5,100.5,98,100.2)], 'INVALIDATED',false],
  ['opening target taken is before later retest', [bar(0,103.5,104,99.5,100.2)], 'INVALIDATED',false],
];

for(const direction of ['long','short']) {
  for(const [name,candles,outcome,triggered] of cases) {
    test(`${direction} structural audit: ${name}`,()=>{
      const s=direction==='long'?setup():setup({direction,stop:101,target:{price:97,name:'PDL',knownAt:start-duration}});
      const result=auditSetups([s],direction==='long'?candles:mirror(candles));
      assert.equal(result.records[0].outcome,outcome);
      assert.equal(result.records[0].triggered,triggered);
      assert.equal(result.summary.total,1);
      assert.equal(result.summary.triggered+result.summary.untriggered+result.summary.ambiguousEntry,1);
      assert.equal(['WIN','LOSS','BE','INVALIDATED','NOT_TRIGGERED','OPEN','AMBIGUOUS']
        .reduce((sum,key)=>sum+result.summary[key],0),1);
    });
  }
}

test('confirmation candle cannot fill an order created at its close',()=>{
  const result=auditSetups([setup({knownAt:start+duration})],[bar(0,100,104,98,101)]);
  assert.equal(result.records[0].outcome,'NOT_TRIGGERED');
  assert.equal(result.records[0].evaluatedBars,0);
});

test('a candle straddling qualification is never used for hindsight fills',()=>{
  const result=auditSetups([setup({knownAt:start+duration/2})],[bar(0,100,104,98,101)]);
  assert.equal(result.records[0].outcome,'NOT_TRIGGERED');
});

test('unknown intrabar retest time is an interval rather than a fabricated timestamp',()=>{
  const r=auditSetups([setup()],[bar(0,100.5,100.8,99.5,100.2)]).records[0];
  assert.equal(r.entryTime,null);
  assert.equal(r.entryTimeFrom,start);
  assert.equal(r.entryTimeTo,start+duration);
  assert.equal(r.maxRExact,false);
  assert.ok(r.maxRUpper>=r.maxRLower);
});

test('a favorable wick after a possible stop does not become exact achieved max R',()=>{
  const r=auditSetups([setup()],[bar(0,100,102,98.5,101)]).records[0];
  assert.equal(r.outcome,'LOSS');
  assert.equal(r.maxRLower,0);
  assert.equal(r.maxRUpper,2);
  assert.equal(r.maxRExact,false);
});

test('overlapping A+ and B setups are audited independently without netting',()=>{
  const result=auditSetups([setup(),setup({id:'b1',grade:'B',direction:'short',stop:101,
    target:{price:97,name:'PDL',knownAt:start-duration}})],[bar(0,100,103.2,99.5,102)]);
  assert.equal(result.summary.total,2);
  assert.equal(result.summary.byGrade['A+'].WIN,1);
  assert.equal(result.summary.byGrade.B.LOSS,1);
});

test('break-even is disabled unless an explicit management rule is supplied',()=>{
  const candles=[bar(0,100,101.2,99.2,101),bar(1,100.6,102,99.8,100.2)];
  assert.equal(auditSetups([setup()],candles).records[0].outcome,'OPEN');
  const r=auditSetups([setup()],candles,{breakevenAfterR:1}).records[0];
  assert.equal(r.outcome,'BREAKEVEN');
  assert.equal(r.breakevenActivatedAt,start+duration);
  assert.equal(r.activeStop,r.entry);
  assert.equal(r.stop,99,'Original structural stop remains frozen as qualification evidence');
});

test('an uncertain pre-entry wick cannot arm a break-even stop',()=>{
  const candles=[bar(0,100.5,101.5,99.5,100.2),bar(1,100.3,100.5,99.5,100.2)];
  const r=auditSetups([setup()],candles,{breakevenAfterR:1}).records[0];
  assert.equal(r.breakevenActivatedAt,null);
  assert.equal(r.outcome,'OPEN');
});

test('target knowledge from the future is rejected',()=>{
  assert.throws(()=>auditSetups([setup({target:{price:103,name:'Future swing',knownAt:start+duration}})],[]),/not known/);
});

test('expiry inside an OHLC candle cannot guess retest chronology',()=>{
  const r=auditSetups([setup({expiresAt:start+duration/2})],[bar(0,100.5,100.8,99.5,100.2)]).records[0];
  assert.equal(r.outcome,'AMBIGUOUS');
  assert.equal(r.triggered,null);
});

test('zero risk and target on the wrong side are rejected',()=>{
  assert.throws(()=>auditSetups([setup({stop:100})],[]),/risk/);
  assert.throws(()=>auditSetups([setup({target:{price:98,name:'Wrong side',knownAt:start-duration}})],[]),/direction/);
});

test('risk units use supplied instrument metadata and quote percentage',()=>{
  const s=setup({symbol:'OANDA:EURUSD',entry:1.125,stop:1.124,
    target:{price:1.128,name:'PDH',knownAt:start-duration},tickSize:0.00001,pipSize:0.0001});
  const r=auditSetups([s],[]).records[0];
  assert.ok(Math.abs(r.riskPriceDistance-0.001)<1e-12);
  assert.ok(Math.abs(r.riskPoints-100)<1e-8);
  assert.ok(Math.abs(r.riskPips-10)<1e-8);
  assert.ok(Math.abs(r.riskPercent-100*0.001/1.125)<1e-10);
  assert.equal(r.symbol,'OANDA:EURUSD');
  const unspecified=auditSetups([setup()],[]).records[0];
  assert.equal(unspecified.riskPoints,null);
  assert.equal(unspecified.riskPips,null);
  for(const key of ['tickSize','pipSize']) {
    assert.throws(()=>auditSetups([setup({[key]:0})],[]),/positive/);
  }
});

test('entry and stop provenance cannot refer to future information',()=>{
  for(const key of ['entryKnownAt','stopKnownAt']) {
    assert.throws(()=>auditSetups([setup({[key]:start+duration})],[]),/follows qualification/);
  }
});

test('supplied evidence is retained independently of trade outcome',()=>{
  const evidence={sweep:{confirmedAt:start-duration},mss:{confirmedAt:start},gradeRule:'6/6'};
  const s=setup({score:{aligned:6,total:6},qualificationEvidence:evidence,zone:{low:99.8,high:100.2}});
  const r=auditSetups([s],[bar(0,100,100.8,98.9,99.5)],{includeRReferences:true}).records[0];
  assert.equal(r.outcome,'LOSS');
  assert.deepEqual(r.qualificationEvidence,evidence);
  assert.deepEqual(r.score,s.score);
  assert.deepEqual(r.zone,s.zone);
  assert.equal(r.qualificationCertified,false,'Outcome evaluator does not certify externally supplied structures');
  assert.equal(r.targetReached,null);
  assert.deepEqual(r.rReferences,{'1R':101,'2R':102,'3R':103});
});

test('touch at unknown time before an exclusive expiry remains ambiguous',()=>{
  const r=auditSetups([setup({expiresAt:start+duration})],[bar(0,100.5,100.8,99.5,100.2)]).records[0];
  assert.equal(r.outcome,'AMBIGUOUS');
  assert.equal(r.triggered,null);
});

test('chart-bar expiry uses observed bars rather than future session timestamps',()=>{
  const s=setup({expiresAfterBars:2});
  const candles=[bar(0,101,102,100.5,101.5),bar(4,101,102,100.5,101.5),bar(8,100,103.2,99.5,102)];
  const r=auditSetups([s],candles).records[0];
  assert.equal(r.outcome,'NOT_TRIGGERED');
  assert.equal(r.triggered,false);
  assert.equal(r.pendingEvaluatedBars,2);
  assert.equal(r.untriggeredReason,'EXPIRED');
  assert.equal(r.pendingAtEnd,false);
  assert.equal(r.outcomeTime,candles[1].closeTime);
  assert.equal(auditSetups([s],candles.slice(0,2)).records[0].outcomeTime,candles[1].closeTime);
});

test('retest in the final allowed bar is eligible and expiry never closes an active trade',()=>{
  const s=setup({expiresAfterBars:2});
  const candles=[bar(0,101,102,100.5,101.5),bar(4,100,101,99.5,100.8),bar(8,101,103.2,100.5,102)];
  const r=auditSetups([s],candles).records[0];
  assert.equal(r.outcome,'WIN');
  assert.equal(r.entryTime,candles[1].openTime);
});

test('expiry settings require one explicit valid policy',()=>{
  assert.throws(()=>auditSetups([setup({expiresAfterBars:0})],[]),/positive integer/);
  assert.throws(()=>auditSetups([setup({expiresAfterBars:2,expiresAt:start+duration})],[]),/not both/);
});

test('unfilled at the history boundary is separated from expired setups',()=>{
  const s=setup({expiresAfterBars:2});
  const result=auditSetups([s],[bar(0,101,102,100.5,101.5)]);
  assert.equal(result.records[0].outcome,'NOT_TRIGGERED');
  assert.equal(result.records[0].untriggeredReason,'END_OF_HISTORY');
  assert.equal(result.records[0].pendingAtEnd,true);
  assert.equal(result.summary.pendingAtEnd,1);
  assert.equal(result.summary.expiredBeforeEntry,0);
});
