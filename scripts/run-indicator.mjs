import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDataProvider, runIndicator } from './runtime.mjs';
import { renderReport } from './report.mjs';

const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!['--data', '--timeframe', '--bars', '--inputs'].includes(args[i]) || !args[i + 1]) {
    throw new Error('Usage: npm run run -- [--data bundle.json] [--timeframe 5] [--bars 3000] [--inputs inputs.json]');
  }
  options[args[i].slice(2)] = args[i + 1];
}
try {
  let provider;
  if (options.data) {
    const bundle = JSON.parse(await readFile(resolve(options.data), 'utf8'));
    provider = createDataProvider(bundle.timeframes, bundle.symbol ?? 'CUSTOM:DMK',
      bundle.description ?? 'User-supplied OHLCV', bundle.symbolInfo ?? {});
  }
  const inputs = options.inputs ? JSON.parse(await readFile(resolve(options.inputs), 'utf8')) : {};
  const { ctx, candles, metadata } = await runIndicator({ provider, inputs,
    timeframe: options.timeframe ?? '5', bars: Number(options.bars ?? 3000) });
  const directory = new URL('../.dmk-results/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('latest.json', directory), JSON.stringify({ metadata, candles, plots: ctx.plots }, null, 2) + '\n');
  await writeFile(new URL('summary.json', directory), JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(new URL('chart.svg', directory), renderReport(candles, ctx.plots, metadata));
  console.log(JSON.stringify(metadata, null, 2));
  console.log('Detailed output: .dmk-results/latest.json');
  console.log('Chart: .dmk-results/chart.svg');
  if (ctx.warnings.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
