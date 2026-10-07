import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDataProvider, runIndicator, executionIndicatorPath } from './runtime.mjs';

try {
  const flags={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!['--data','--timeframe','--bars','--inputs'].includes(args[i]) || !args[i+1]) {
      throw new Error('Usage: npm run run:execution -- [--data bundle.json] [--timeframe 15] [--bars 3000] [--inputs inputs.json]');
    }
    flags[args[i].slice(2)]=args[i+1];
  }
  const load=async name=>JSON.parse(await readFile(resolve(name),'utf8'));
  let provider;
  if(flags.data) {
    const bundle=await load(flags.data);
    if(!Number.isFinite(bundle.symbolInfo?.mintick) || bundle.symbolInfo.mintick<=0) {
      throw new Error('Native execution requires bundle.symbolInfo.mintick to match the instrument; a generic runtime default cannot set structural SL or exact entry units.');
    }
    provider=createDataProvider(bundle.timeframes,bundle.symbol??'CUSTOM:DMK',
      bundle.description??'User-supplied OHLCV',bundle.symbolInfo??{});
  }
  const result=await runIndicator({provider,sourcePath:executionIndicatorPath,
    timeframe:flags.timeframe??'5',bars:Number(flags.bars??3000),
    inputs:flags.inputs?await load(flags.inputs):{}});
  const directory=new URL('../.dmk-results/',import.meta.url);
  await mkdir(directory,{recursive:true});
  await writeFile(new URL('pine-execution.json',directory),JSON.stringify({metadata:result.metadata,
    candles:result.candles,plots:result.ctx.plots},null,2)+'\n');
  const auditTotals=Object.fromEntries(Object.entries(result.ctx.plots)
    .filter(([name])=>name.startsWith('Strict ') || name.startsWith('A+ '))
    .map(([name,plot])=>[name,plot.data.at(-1)?.value??null]));
  console.log(JSON.stringify({...result.metadata,auditTotals},null,2));
  console.log('Native Pine execution output: .dmk-results/pine-execution.json');
  if(result.metadata.warnings.length) process.exitCode=1;
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
