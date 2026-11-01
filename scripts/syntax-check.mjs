import { spawnSync } from 'node:child_process';
const files = ['app.js', 'core.js', 'score-v2.js', 'performance-analysis.js', 'analysis-worker.js', 'gen-worker.js', 'smartgen.js', 'compose.js', 'patterns.js', 'tempomap.js', 'beatgrid.js', 'difficulty.js', 'cache.js', 'sections.js', 'quality-extra.js', 'autofix.js', 'genclient.js', ...process.argv.slice(2)];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; process.stderr.write(`${file}:\n${result.stderr}`); }
  else process.stdout.write(`syntax ok: ${file}\n`);
}
if (failed) process.exitCode = 1;
