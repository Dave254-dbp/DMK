import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createDataProvider, createSyntheticProvider, runIndicator } from './runtime.mjs';
import { detectStructuralSetups } from './structural-setups.mjs';
import { auditSetups } from './setup-audit.mjs';
import { renderStructuralReport } from './structural-report.mjs';

try {
  const flags={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!['--data','--timeframe','--bars','--inputs','--rules','--output'].includes(args[i]) || !args[i+1]) {
      throw new Error('Usage: npm run audit:structural -- [--data bundle.json] [--timeframe 15] [--bars 3000] [--inputs inputs.json] [--rules rules.json] [--output report.json]');
    }
    flags[args[i].slice(2)]=args[i+1];
  }
  const load=async name=>JSON.parse(await readFile(resolve(name),'utf8'));
  const bundle=flags.data?await load(flags.data):null;
  const provider=bundle?createDataProvider(bundle.timeframes,bundle.symbol??'CUSTOM:DMK',
    bundle.description??'User-supplied OHLCV',bundle.symbolInfo??{}):createSyntheticProvider();
  const rules=flags.rules?await load(flags.rules):{};
  const timeframe=flags.timeframe??'5';
  const allChartBars=bundle?.timeframes?.[timeframe]?.length;
  const result=await runIndicator({provider,auditContext:true,timeframe,
    bars:Number(flags.bars??allChartBars??3000),inputs:flags.inputs?await load(flags.inputs):{}});
  const dailyCandles=await provider.getMarketData(provider.symbol,'D',undefined,undefined,result.candles.at(-1)?.closeTime);
  const selection=detectStructuralSetups(result,{...rules,dailyCandles,
    tickSize:Object.hasOwn(rules,'tickSize')?rules.tickSize:
      (bundle?bundle.symbolInfo?.mintick??null:result.metadata.symbolInfo.mintick),
    pipSize:Object.hasOwn(rules,'pipSize')?rules.pipSize:bundle?.symbolInfo?.pipSize??null});
  const audit=auditSetups(selection.setups,result.candles,{
    invalidateOnTargetTaken:true,
    includeRReferences:rules.includeRReferences??false,
    breakevenAfterR:rules.breakevenAfterR??null,
  });
  const sourceHashes={};
  for(const name of ['structural-setups.mjs','setup-audit.mjs']) {
    sourceHashes[name]=createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex');
  }
  const report={metadata:{...result.metadata,purpose:'Confirmed structural reference-level setup audit',
      auditSourceHashes:sourceHashes,assumptions:selection.metadata.assumptions,diagnostics:selection.diagnostics},
    settings:selection.settings,selectionCounts:selection.counts,
    structuralCandidates:selection.structuralCandidates,structuralRejections:selection.structuralRejections,
    legacyAudit:selection.legacyAudit,...audit};
  const output=resolve(flags.output??'.dmk-results/structural-audit.json');
  const html=output.replace(/\.json$/i,'')+'.html';
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  await writeFile(html,renderStructuralReport({...report,candles:result.candles}));
  console.log(JSON.stringify({data:report.metadata.data,symbol:report.metadata.symbol,
    selection:report.selectionCounts,outcomes:report.summary},null,2));
  console.log(`Complete records: ${output}\nInteractive report: ${html}`);
  if(result.metadata.warnings.length) process.exitCode=1;
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
