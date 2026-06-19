/**
 * Simplified DGA-inspired calorie target calculator (educational).
 * Mifflin–St Jeor BMR + activity multiplier + adjusted body weight for BMI ≥ 30.
 */

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
};

const DEFAULT_ACTIVITY_LEVEL = 'sedentary';
const BMI_ADJUSTED_WEIGHT_THRESHOLD = 30;
const ADJUSTED_WEIGHT_FACTOR = 0.25;
const MIN_CALORIES_FEMALE = 1200;
const MIN_CALORIES_MALE = 1500;
const ABSOLUTE_MAX_KCAL = 4500;

function computeAgeYears(dateOfBirth, refDate = new Date('2026-05-24')) {
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

function resolveBmrSexBasis(gender) {
  if (gender === 'female') return 'female';
  if (gender === 'male') return 'male';
  if (gender === 'nonbinary' || gender === 'other' || gender === 'prefer_not_to_say') {
    return 'average';
  }
  return 'male';
}

function computeBmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function idealBodyWeightKg(heightCm, sexBasis) {
  const heightIn = heightCm / 2.54;
  const inchesOver5ft = Math.max(0, heightIn - 60);
  const femaleIbw = 45.5 + 2.3 * inchesOver5ft;
  const maleIbw = 50 + 2.3 * inchesOver5ft;
  if (sexBasis === 'female') return femaleIbw;
  if (sexBasis === 'male') return maleIbw;
  return (femaleIbw + maleIbw) / 2;
}

function effectiveWeightForBmr(weightKg, heightCm, sexBasis) {
  const bmi = computeBmi(weightKg, heightCm);
  if (bmi == null || bmi < BMI_ADJUSTED_WEIGHT_THRESHOLD) {
    return weightKg;
  }
  const ibw = idealBodyWeightKg(heightCm, sexBasis);
  return Math.round((ibw + ADJUSTED_WEIGHT_FACTOR * (weightKg - ibw)) * 10) / 10;
}

function basalMetabolicRate(weightKg, heightCm, ageYears, sexBasis) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (sexBasis === 'female') return base - 161;
  if (sexBasis === 'male') return base + 5;
  const male = base + 5;
  const female = base - 161;
  return (male + female) / 2;
}

function minCaloriesForSexBasis(sexBasis) {
  if (sexBasis === 'female') return MIN_CALORIES_FEMALE;
  if (sexBasis === 'male') return MIN_CALORIES_MALE;
  return Math.round((MIN_CALORIES_FEMALE + MIN_CALORIES_MALE) / 2);
}

/**
 * Maintenance-mode daily calories (kcal) for a profile object.
 * @param {object} profile
 * @returns {number}
 */
function calculateCalories(profile) {
  const age = computeAgeYears(profile.dateOfBirth);
  const weightKg = Number(profile.weightKg);
  const heightCm = Number(profile.heightCm);
  const activityLevel = profile.activityLevel || DEFAULT_ACTIVITY_LEVEL;
  const activityMult = ACTIVITY_MULTIPLIERS[activityLevel] ?? ACTIVITY_MULTIPLIERS.sedentary;

  const sexBasis = resolveBmrSexBasis(profile.gender);
  const weightForBmr = effectiveWeightForBmr(weightKg, heightCm, sexBasis);
  const bmr = basalMetabolicRate(weightForBmr, heightCm, age, sexBasis);
  let caloriesKcal = Math.round(bmr * activityMult);

  const floor = minCaloriesForSexBasis(sexBasis);
  caloriesKcal = Math.max(floor, caloriesKcal);
  caloriesKcal = Math.min(ABSOLUTE_MAX_KCAL, caloriesKcal);

  return caloriesKcal;
}

module.exports = {
  calculateCalories,
  computeAgeYears,
  computeBmi,
  ACTIVITY_MULTIPLIERS,
};
