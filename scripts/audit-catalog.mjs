import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDataProvider, runIndicator } from './runtime.mjs';
import { buildLegacyCatalog } from './audit-context.mjs';

try {
  const flags={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!['--data','--timeframe','--bars','--inputs'].includes(args[i]) || !args[i+1]) throw new Error('Use --data bundle.json, --timeframe 15, --bars count and/or --inputs inputs.json.');
    flags[args[i].slice(2)]=args[i+1];
  }
  const load=async name=>JSON.parse(await readFile(resolve(name),'utf8'));
  let provider;
  if(flags.data) {
    const bundle=await load(flags.data);
    provider=createDataProvider(bundle.timeframes,bundle.symbol??'CUSTOM:DMK',bundle.description??'User-supplied OHLCV',bundle.symbolInfo??{});
  }
  const result=await runIndicator({provider,timeframe:flags.timeframe??'5',bars:Number(flags.bars??3000),
    inputs:flags.inputs?await load(flags.inputs):{},auditContext:true});
  const catalog=buildLegacyCatalog(result);
  await mkdir(new URL('../.dmk-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.dmk-results/legacy-a-plus.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
  console.log(JSON.stringify({data:catalog.metadata.data,symbol:catalog.metadata.symbol,...catalog.counts},null,2));
  console.log('Legacy label catalog: .dmk-results/legacy-a-plus.json. Entry/exit outcomes are undefined until structural execution is specified.');
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
