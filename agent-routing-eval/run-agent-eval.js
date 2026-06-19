const fs = require('fs');
const path = require('path');
const { detectAction, inferTools } = require('./router');

const tagFilter = process.argv.includes('--tags')
  ? process.argv[process.argv.indexOf('--tags') + 1].split(',')
  : null;
const verbose = process.argv.includes('--verbose');

const files = ['navigation.json', 'compound.json'];
let passed = 0;
let failed = 0;

function tagsMatch(c) {
  if (!tagFilter) return true;
  return c.tags?.some((t) => tagFilter.includes(t));
}

function evaluateNavigationCase(c) {
  const result = detectAction(c.input.userText, c.input.locale || 'en');
  return JSON.stringify(result) === JSON.stringify(c.expected);
}

function evaluateCompoundCase(c) {
  const tools = inferTools(c.input.userText);
  const exp = c.expected;

  if (exp.tools) {
    const expectedTools = [...exp.tools].sort();
    const actualTools = tools.filter((t) => expectedTools.includes(t)).sort();
    if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
      return { ok: false, tools };
    }
  }

  if (exp.forbidden) {
    for (const forbidden of exp.forbidden) {
      if (tools.includes(forbidden)) {
        return { ok: false, tools };
      }
    }
  }

  if (exp.forbidden_tools) {
    for (const forbidden of exp.forbidden_tools) {
      if (tools.includes(forbidden)) {
        return { ok: false, tools };
      }
    }
  }

  return { ok: true, tools };
}

for (const file of files) {
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases', file), 'utf8'));
  const isCompound = file === 'compound.json';

  for (const c of suite.cases) {
    if (!tagsMatch(c)) continue;

    let ok;
    let detail;

    if (isCompound) {
      const result = evaluateCompoundCase(c);
      ok = result.ok;
      detail = result.tools;
    } else {
      ok = evaluateNavigationCase(c);
      detail = detectAction(c.input.userText, c.input.locale || 'en');
    }

    if (ok) passed++;
    else failed++;

    if (verbose || !ok) {
      console.log(`${ok ? '✓' : '✗'} ${c.id}: ${c.description}`);
      if (!ok) console.log('   expected', c.expected, 'got', detail);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
