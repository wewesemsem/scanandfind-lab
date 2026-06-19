/**
 * Seeded synthetic adult profiles from published NHANES summary statistics.
 * No individual NHANES records — educational sampler for population evals.
 */

const NHANES_STATS = {
  female: { heightMean: 161.4, heightSd: 6.6, weightMean: 81.5, weightSd: 22.0 },
  male: { heightMean: 175.4, heightSd: 7.2, weightMean: 90.3, weightSd: 22.5 },
};

const ACTIVITY_WEIGHTS = {
  sedentary: 0.4,
  lightly_active: 0.3,
  moderately_active: 0.2,
  very_active: 0.1,
};

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(rng, mean, sd) {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function dateOfBirthFromAge(ageYears, refDate) {
  const year = refDate.getFullYear() - ageYears;
  const month = refDate.getMonth() + 1;
  const day = refDate.getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {{ count?: number, seed?: number, refDate?: string }} options
 * @returns {Array<object>} profile objects ready for goalCalculator-lite
 */
function sampleProfiles({ count = 200, seed = 20260524, refDate = '2026-05-24' } = {}) {
  const rng = createSeededRandom(seed);
  const ref = new Date(refDate);
  const profiles = [];

  for (let i = 0; i < count; i += 1) {
    const female = rng() < 0.51;
    const gender = female ? 'female' : 'male';
    const stats = NHANES_STATS[gender];
    const ageYears = Math.floor(rng() * (80 - 18 + 1)) + 18;
    const heightCm = round1(clamp(normalSample(rng, stats.heightMean, stats.heightSd), 140, 200));
    const weightKg = round1(clamp(normalSample(rng, stats.weightMean, stats.weightSd), 40, 200));
    const activityLevel = pickWeighted(rng, ACTIVITY_WEIGHTS);

    profiles.push({
      dateOfBirth: dateOfBirthFromAge(ageYears, ref),
      gender,
      heightCm,
      weightKg,
      activityLevel,
      surveyResponses: { pregnancyStatus: 'not_pregnant' },
    });
  }

  return profiles;
}

module.exports = {
  sampleProfiles,
  createSeededRandom,
  NHANES_STATS,
  ACTIVITY_WEIGHTS,
};
