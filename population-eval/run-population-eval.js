const { sampleProfiles } = require('./nhanesSampler-lite');
const { calculateCalories } = require('./goalCalculator-lite');
const { dgaBand, isWithinBand } = require('./dgaReference-lite');
const personas = require('./synthetic-personas.json');

const SEED = 20260524;
const N = 200; // lab uses 200; production uses 1000
const MIN_WITHIN_BAND = 0.85;

function runPopulation() {
  const cohort = sampleProfiles({ count: N, seed: SEED });
  let within = 0;
  for (const p of cohort) {
    const kcal = calculateCalories(p);
    const band = dgaBand(p);
    if (isWithinBand(kcal, band)) within++;
  }
  const pct = within / N;
  const pass = pct >= MIN_WITHIN_BAND;
  console.log(`Population: ${within}/${N} (${(pct * 100).toFixed(1)}%) within DGA band`);
  console.log(pass ? 'PASS' : 'FAIL', `(need ≥ ${MIN_WITHIN_BAND * 100}%)`);
  return pass;
}

function runPersonas() {
  console.log('\nHand-curated personas:');
  let allPass = true;
  for (const row of personas.users) {
    const kcal = calculateCalories(row.profile);
    const { plausibility } = row;
    const ok = kcal >= plausibility.caloriesMin && kcal <= plausibility.caloriesMax;
    if (!ok) allPass = false;
    console.log(`  ${row.id}: ${kcal} kcal — ${ok ? 'PASS' : 'FAIL'}`);
  }
  return allPass;
}

const populationPass = runPopulation();
const personasPass = runPersonas();

if (!populationPass || !personasPass) {
  process.exit(1);
}
