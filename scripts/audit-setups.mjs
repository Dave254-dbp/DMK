import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { auditSetups } from './setup-audit.mjs';

try {
  const flags={}, args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {
    if(!['--setups','--candles','--options','--output'].includes(args[i]) || !args[i+1]) {
      throw new Error('Usage: npm run audit:setups -- --setups qualified.json --candles candles.json [--options options.json] [--output report.json]');
    }
    flags[args[i].slice(2)]=args[i+1];
  }
  if(!flags.setups || !flags.candles) throw new Error('Provide qualified setup records and historical candles; a screenshot or A+ alignment label is not an executed trade.');
  const load=async name=>JSON.parse(await readFile(resolve(name),'utf8'));
  const result=auditSetups(await load(flags.setups),await load(flags.candles),flags.options?await load(flags.options):{});
  const output=resolve(flags.output??'.dmk-results/setup-audit.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.summary,null,2));
  console.log(`Audit records: ${output}`);
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
