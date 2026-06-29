/**
 * Educational pattern matcher for assistant navigation + tool inference.
 * Simplified subset of production assistantTools + toolRegistry behavior.
 *
 * NOT production NLU: production uses an LLM + safety/skills/tools pipeline;
 * this stub is deterministic for fast, keyless CI. See README Part 2.
 */

const NEGATIVE_PATTERNS = [
  /\b(is|are|was|were)\s+.+\s+(safe|healthy|bad|good)\b/i,
  /\bwhat\s+(is|are|was)\s+(a\s+)?(healthy|good)\s+diet\b/i,
  /\bhow\s+(much|many)\s+(calories|sodium|sugar|protein)\b/i,
  /\bshould\s+i\s+(eat|avoid|take)\b/i,
  /\b(tell|explain)\s+me\s+about\b/i,
];

const SCAN_INTENT_VERBS =
  /\b(scan|picture|photo|pic|shoot|camera|photograph|identify|scam)\b/i;

const BENEFITS_PROGRAM_PATTERNS = [/\b(snap|medicaid|wic|liheap)\b/i];

const SCAN_PATTERNS = {
  food: [
    /\b(scan|scam|open).{0,20}(my\s+)?(food|meal|lunch|dinner|breakfast)\b/i,
    /\bscam\s+(my\s+)?(food|meal|lunch|dinner|breakfast)\b/i,
    /\b(food|meal)\s+(scan|scanner|camera)\b/i,
  ],
  plastic: [/\b(scan|open).{0,20}(plastic|bottle|container|pfas)\b/i],
  meds: [/\b(scan|open).{0,20}(meds?|medicine|medication|prescription)\b/i],
  pets: [/\b(scan|open).{0,20}(pet\s+food|pet\s+product)\b/i],
  nature: [/\b(identify|scan).{0,20}(flower|plant|bird|nature)\b/i],
  recycling: [/\b(scan|photo).{0,40}(recycl|recycling|recycle)\b/i],
};

const SDOH_INTENT_PATTERNS = [
  /\b(snap|medicaid|wic|liheap|section\s*8)\b/i,
  /\b(food\s+(bank|assistance|insecurity|stamps?)|hungry|can'?t\s+afford\s+food)\b/i,
  /\b(housing|homeless|shelter|rent\s+help|eviction|utilities?\s+help)\b/i,
  /\b(benefits?\s+eligib|apply\s+for\s+(snap|medicaid|wic|housing))\b/i,
  /\b(211|community\s+resources?|local\s+(help|services?|support))\b/i,
];

const HEALTHY_MAP_PATTERNS = [
  /\b(hotel area|traveling next week|healthy groceries|grocery store|supermarket|farmers'? market)\b/i,
  /\b(find|local|near|nearby).{0,30}(gym|trail|park|farmers'? market|grocery)\b/i,
  /\b\d{5}\b/,
];

function normalize(text) {
  return String(text || '').trim();
}

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function hasScanIntent(text) {
  return SCAN_INTENT_VERBS.test(text);
}

function isBenefitsProgramQuery(text) {
  return matchesAny(text, BENEFITS_PROGRAM_PATTERNS);
}

function shouldInferSdoh(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (/\b(scan|photo|picture|camera|open\s+(the\s+)?scanner)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(calories|nutrition|protein|sodium|nutrients?|macro)\b/i.test(normalized)) {
    return false;
  }
  return SDOH_INTENT_PATTERNS.some((re) => re.test(normalized));
}

function shouldInferHealthyMap(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (/\b(scan|photo|picture|camera|open\s+(the\s+)?scanner)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(calories|nutrition|protein|sodium|nutrients?|macro)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(snap|medicaid|wic|sdoh|food\s+assistance|housing\s+help)\b/i.test(normalized)) {
    return false;
  }
  return HEALTHY_MAP_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Navigation action detection (scan vs stay in chat).
 * @returns {{ type: 'navigate', target: 'scan', scanTarget: string } | { type: 'none' }}
 */
function detectAction(userText, locale = 'en') {
  const text = normalize(userText);
  void locale;
  if (!text) return { type: 'none' };

  if (matchesAny(text, NEGATIVE_PATTERNS) && !hasScanIntent(text)) {
    return { type: 'none' };
  }

  if (isBenefitsProgramQuery(text)) {
    return { type: 'none' };
  }

  for (const [scanTarget, patterns] of Object.entries(SCAN_PATTERNS)) {
    if (matchesAny(text, patterns)) {
      return { type: 'navigate', target: 'scan', scanTarget };
    }
  }

  const scanLike = hasScanIntent(text) || /\b(scam|scan)\b/i.test(text);
  if (
    scanLike &&
    /\b(food|meal|eating|lunch|dinner|breakfast|snack)\b/i.test(text)
  ) {
    return { type: 'navigate', target: 'scan', scanTarget: 'food' };
  }

  if (scanLike) {
    return { type: 'navigate', target: 'scan', scanTarget: 'health_ai' };
  }

  return { type: 'none' };
}

/**
 * Simplified tool inference for compound routing cases.
 * @returns {string[]}
 */
function inferTools(userText) {
  const text = normalize(userText);
  const tools = [];
  if (!text) return tools;

  const action = detectAction(text);
  if (action.type === 'navigate' && action.target === 'scan') {
    tools.push(`navigate_${action.scanTarget}_scan`);
  }

  if (/\b(calories|nutrition|protein|sodium|sugar|fiber|macro)\b/i.test(text)) {
    tools.push('nutrition_lookup');
  }

  if (shouldInferSdoh(text)) {
    tools.push('sdoh_navigator');
  }

  if (shouldInferHealthyMap(text)) {
    tools.push('healthy_map');
  }

  if (
    !tools.includes('sdoh_navigator') &&
    !tools.includes('healthy_map') &&
    /\b(search|google|look up online|find on the web)\b/i.test(text)
  ) {
    tools.push('search_internet');
  }

  return [...new Set(tools)];
}

module.exports = {
  detectAction,
  inferTools,
};
