// Preserve the historical signal population. No entry, stop, target or outcome
// is invented from an alignment label. Structural selection is a separate step.
export function buildLegacyCatalog({ctx, candles, metadata}) {
  const observe = (name,index) => {
    const value=ctx.plots[`Audit ${name}`]?.data[index]?.value;
    return Number.isFinite(value) ? value : null;
  };
  const tiers=['M','W','D','4H','1H','E'];
  const events={1:'BOS',2:'CHoCH',3:'Custom MSS'};
  const lastMSS=new Map();
  const lastReclaim=new Map();
  const gaps=[];
  const records=[];
  for(let index=0;index<candles.length;index++) {
    const candle=candles[index];
    const event=observe('Event E',index), direction=observe('Direction E',index);
    if(event===3) lastMSS.set(direction,{barOpen:candle.openTime,confirmedAt:candle.closeTime,
      definition:'DMK v0.3 second opposing break while pending; sweep/displacement not required'});
    const priorHigh=observe('Prior protected high',index), priorLow=observe('Prior protected low',index);
    if(priorHigh!=null && candle.high>priorHigh && candle.close<priorHigh) {
      lastReclaim.set(-1,{reference:priorHigh,extreme:candle.high,confirmedAt:candle.closeTime,
        description:'Observed wick above prior protected high and close below; not yet an approved sweep rule'});
    }
    if(priorLow!=null && candle.low<priorLow && candle.close>priorLow) {
      lastReclaim.set(1,{reference:priorLow,extreme:candle.low,confirmedAt:candle.closeTime,
        description:'Observed wick below prior protected low and close above; not yet an approved sweep rule'});
    }
    if(index>=2) {
      const earlier=candles[index-2];
      if(candle.low>earlier.high) gaps.push({direction:1,low:earlier.high,high:candle.low,confirmedAt:candle.closeTime});
      if(candle.high<earlier.low) gaps.push({direction:-1,low:candle.high,high:earlier.low,confirmedAt:candle.closeTime});
    }
    for(const [plotName,dir] of [['A+ Buy',1],['A+ Sell',-1]]) {
      const signal=ctx.plots[plotName].data[index].value;
      if(signal!==true && signal!==1) continue;
      const mss=lastMSS.get(dir)??null;
      const reclaim=lastReclaim.get(dir)??null;
      // A geometrical gap alone is not validated POI eligibility or a retest.
      const gap=gaps.findLast(g=>g.direction===dir && mss && g.confirmedAt>=mss.confirmedAt)??null;
      records.push({id:`${metadata.symbol}:${candle.openTime}:${dir}`,grade:'Legacy A+',
        direction:dir===1?'long':'short',signalBarOpen:candle.openTime,signalConfirmedAt:candle.closeTime,
        tiers:Object.fromEntries(tiers.map(t=>[t,{trend:observe(`Trend ${t}`,index),
          pendingUp:observe(`Pending up ${t}`,index)===1,pendingDown:observe(`Pending down ${t}`,index)===1}])),
        executionEvent:events[event]??null,
        observations:{lastCustomMSS:mss,lastCrossAndReclaim:reclaim,lastConfirmedThreeCandleGap:gap},
        executionQualification:null,entry:null,stop:null,target:null,outcome:null,
        reason:'Execution rules, structural sequence/POI validation and data must be specified; alignment alone has no trade outcome'});
    }
  }
  return {metadata:{...metadata,purpose:'Legacy signal population and causal observations; no trade-performance claim'},
    counts:{legacyAPlus:records.length,tradeOutcomesDefined:0},records};
}
