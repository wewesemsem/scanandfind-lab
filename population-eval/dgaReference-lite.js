/**
 * DGA 2020–2025 estimated calorie needs (Appendix 2 style) for population plausibility.
 * Educational subset — see production test/evals/dgaCalorieReference.js for full tables.
 */

const ACTIVITY_LEVELS = ['sedentary', 'lightly_active', 'moderately_active', 'very_active'];

const DGA_CALORIE_BRACKETS = [
  {
    minAge: 18,
    maxAge: 31,
    female: {
      sedentary: [1800, 2000],
      lightly_active: [1900, 2100],
      moderately_active: [2000, 2200],
      very_active: [2400, 2600],
    },
    male: {
      sedentary: [2400, 2600],
      lightly_active: [2500, 2700],
      moderately_active: [2600, 2800],
      very_active: [3000, 3200],
    },
  },
  {
    minAge: 31,
    maxAge: 51,
    female: {
      sedentary: [1700, 1900],
      lightly_active: [1800, 2000],
      moderately_active: [1900, 2100],
      very_active: [2200, 2400],
    },
    male: {
      sedentary: [2200, 2400],
      lightly_active: [2300, 2500],
      moderately_active: [2400, 2600],
      very_active: [2800, 3000],
    },
  },
  {
    minAge: 51,
    maxAge: 101,
    female: {
      sedentary: [1500, 1700],
      lightly_active: [1600, 1800],
      moderately_active: [1700, 1900],
      very_active: [2100, 2300],
    },
    male: {
      sedentary: [2000, 2200],
      lightly_active: [2100, 2300],
      moderately_active: [2200, 2400],
      very_active: [2600, 2800],
    },
  },
];

const DEFAULT_TOLERANCE_PCT = 0.35;
const DEFAULT_TOLERANCE_MIN_KCAL = 450;

function computeAgeYears(dateOfBirth, refDate = new Date()) {
  if (!dateOfBirth) return null;
  const [y, m, d] = String(dateOfBirth).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dob = new Date(y, m - 1, d);
  let age = refDate.getFullYear() - dob.getFullYear();
  const monthDiff = refDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && refDate.getDate() < dob.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

function findAgeBracket(ageYears) {
  return DGA_CALORIE_BRACKETS.find((b) => ageYears >= b.minAge && ageYears < b.maxAge);
}

function dgaPlausibleCalorieBand({ ageYears, gender, activityLevel }) {
  const bracket = findAgeBracket(ageYears);
  if (!bracket) return null;

  const sexKey = gender === 'female' ? 'female' : 'male';
  const level = ACTIVITY_LEVELS.includes(activityLevel) ? activityLevel : 'sedentary';
  const [dgaLow, dgaHigh] = bracket[sexKey][level];
  const mid = (dgaLow + dgaHigh) / 2;
  const spread = Math.max(DEFAULT_TOLERANCE_MIN_KCAL, mid * DEFAULT_TOLERANCE_PCT);

  return {
    dgaLow,
    dgaHigh,
    mid,
    low: Math.round(dgaLow - spread),
    high: Math.round(dgaHigh + spread),
  };
}

/** Profile-aware band helper used by run-population-eval.js */
function dgaBand(profile, refDate = new Date('2026-05-24')) {
  const ageYears = computeAgeYears(profile.dateOfBirth, refDate);
  if (ageYears == null) return null;
  return dgaPlausibleCalorieBand({
    ageYears,
    gender: profile.gender,
    activityLevel: profile.activityLevel || 'sedentary',
  });
}

function isWithinBand(caloriesKcal, band) {
  if (!band) return true;
  return caloriesKcal >= band.low && caloriesKcal <= band.high;
}

module.exports = {
  dgaBand,
  dgaPlausibleCalorieBand,
  isWithinBand,
  DEFAULT_TOLERANCE_PCT,
  DEFAULT_TOLERANCE_MIN_KCAL,
};
