'use strict';
/**
 * Regenerates testing evidence as UTF-8 text files in docs/.
 *   node scripts/capture-evidence.js
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const run = (args) => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  return strip(`${r.stdout || ''}${r.stderr || ''}`);
};
const stamp = `Generated: ${new Date().toISOString()} · Node ${process.version} · ${process.platform}\n\n`;

const tests = run(['--test', '--test-reporter=spec', ...fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => `tests/${f}`)]);
fs.writeFileSync(path.join(ROOT, 'docs/test-results.txt'), `Command: npm run test:report\n${stamp}${tests}`, 'utf8');

const demo = run(['scripts/demo-illegal-transition.js']);
fs.writeFileSync(path.join(ROOT, 'docs/db-enforcement-demo.txt'), `Command: npm run demo:illegal\n${stamp}${demo}`, 'utf8');

console.log(tests.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join('\n'));
