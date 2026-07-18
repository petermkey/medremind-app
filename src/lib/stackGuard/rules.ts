// W3-A Stack Guard — CURATED interaction/timing rules. Versioned, in-repo,
// every rule cites NIH ODS or a peer-reviewed source. NEVER LLM-generated at
// runtime (master-plan Safety constraint). Leaf module: zero imports, relative
// consumers only, registered in test:unit (daySchedule.ts precedent).

export const STACK_GUARD_RULESET_VERSION = 1;

export type StackGuardSeverity = 'info' | 'caution';

type RuleBase = {
  id: string;
  severity: StackGuardSeverity;
  title: string;
  explanation: string;
  suggestion: string;
  source: string;
};

export type PairRule = RuleBase & {
  kind: 'pair';
  groupA: string[];
  groupB: string[];
  sameSlotOnly: boolean;
};

export type AliasMealSlotRule = RuleBase & {
  kind: 'alias_meal_slot';
  aliases: string[];
};

export type EmptyStomachMealSlotRule = RuleBase & {
  kind: 'empty_stomach_meal_slot';
};

export type SingleDoseLimitRule = RuleBase & {
  kind: 'single_dose_limit';
  aliases: string[];
  nutrientToken: string;
  maxAmount: number;
  unit: 'mg';
};

export type StackGuardRule =
  | PairRule
  | AliasMealSlotRule
  | EmptyStomachMealSlotRule
  | SingleDoseLimitRule;

export const NUTRIENT_ALIASES: Record<string, string[]> = {
  iron: ['iron', 'ferrous', 'ferric', 'железо', 'железа'],
  calcium: ['calcium', 'кальций', 'кальция'],
  magnesium: ['magnesium', 'магний', 'магния'],
  zinc: ['zinc', 'цинк', 'цинка'],
  copper: ['copper', 'медь', 'меди'],
  vitamin_d: ['vitamin d', 'vitamind', 'витамин d', 'витамин д', 'cholecalciferol', 'колекальциферол', 'холекальциферол', 'd3', 'д3'],
  omega3: ['omega', 'омега', 'fish oil', 'рыбий жир', 'epa', 'dha', 'эпк', 'дгк'],
  vitamin_c: ['vitamin c', 'vitaminc', 'витамин c', 'витамин с', 'ascorb', 'аскорбин'],
  b12: ['b12', 'б12', 'cobalamin', 'кобаламин'],
  folate: ['folate', 'folic', 'фолиев', 'фолат'],
  melatonin: ['melatonin', 'мелатонин'],
  potassium: ['potassium', 'калий', 'калия'],
};

export const NUTRIENT_LABELS: Record<string, string> = {
  iron: 'iron',
  calcium: 'calcium',
  magnesium: 'magnesium',
  zinc: 'zinc',
  copper: 'copper',
  vitamin_d: 'vitamin D',
  omega3: 'omega-3',
  vitamin_c: 'vitamin C',
  b12: 'vitamin B12',
  folate: 'folate',
  melatonin: 'melatonin',
  potassium: 'potassium',
};

const IRON = NUTRIENT_ALIASES.iron;
const CALCIUM = NUTRIENT_ALIASES.calcium;
const MAGNESIUM = NUTRIENT_ALIASES.magnesium;
const ZINC = NUTRIENT_ALIASES.zinc;
const COPPER = NUTRIENT_ALIASES.copper;
const OMEGA3 = NUTRIENT_ALIASES.omega3;
const VITAMIN_C = NUTRIENT_ALIASES.vitamin_c;
const LEVOTHYROXINE = ['levothyroxine', 'synthroid', 'levoxyl', 'левотироксин', 'эутирокс', 'l-тироксин', 'тироксин'];

export const STACK_GUARD_RULES: readonly StackGuardRule[] = [
  {
    id: 'iron_calcium_same_slot',
    kind: 'pair',
    severity: 'caution',
    groupA: IRON,
    groupB: CALCIUM,
    sameSlotOnly: true,
    title: 'Iron and calcium in the same slot',
    explanation: 'Calcium can reduce iron absorption when taken at the same time, so part of the iron dose may be wasted.',
    suggestion: 'Separate the doses by at least 2 hours, for example iron in the morning on an empty stomach and calcium in the evening.',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'iron_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Iron and zinc in the same slot',
    explanation: 'Iron and zinc can compete for absorption, especially in supplement form and on an empty stomach.',
    suggestion: 'When possible, take iron and zinc in different slots or at least 2 hours apart.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'iron_magnesium_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: MAGNESIUM,
    sameSlotOnly: true,
    title: 'Iron and magnesium in the same slot',
    explanation: 'Magnesium-containing products, including magnesium oxide, can reduce iron absorption when taken together.',
    suggestion: 'Separate iron and magnesium into different slots, at least 2 hours apart.',
    source: 'Campbell NR, Hasinoff BB. Iron supplements: a common cause of drug interactions. Br J Clin Pharmacol. 1991;31(3):251-255.',
  },
  {
    id: 'calcium_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: CALCIUM,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Calcium and zinc in the same slot',
    explanation: 'High calcium doses may moderately reduce zinc absorption when taken at the same time.',
    suggestion: 'If both are needed daily, use different slots during the day.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'zinc_copper_balance',
    kind: 'pair',
    severity: 'caution',
    groupA: ZINC,
    groupB: COPPER,
    sameSlotOnly: false,
    title: 'Zinc can reduce copper absorption',
    explanation: 'Long-term zinc use, especially 50 mg/day or more, can reduce copper absorption and may contribute to copper deficiency.',
    suggestion: 'Take zinc and copper at different times; for long-term high-dose zinc, discuss copper balance with a clinician.',
    source: 'NIH ODS — Zinc: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/ and NIH ODS — Copper: https://ods.od.nih.gov/factsheets/Copper-HealthProfessional/',
  },
  {
    id: 'levothyroxine_mineral_spacing',
    kind: 'pair',
    severity: 'caution',
    groupA: LEVOTHYROXINE,
    groupB: [...IRON, ...CALCIUM, ...MAGNESIUM],
    sameSlotOnly: false,
    title: 'Levothyroxine and minerals (iron/calcium/magnesium)',
    explanation: 'Iron, calcium, and magnesium can bind levothyroxine in the gut and meaningfully reduce absorption, even when taken within a few hours.',
    suggestion: 'Take levothyroxine at least 4 hours before or after iron, calcium, and magnesium.',
    source: 'FDA label — SYNTHROID (levothyroxine sodium), Drug Interactions; NIH ODS — Calcium: https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  },
  {
    id: 'sjw_serotonergic',
    kind: 'pair',
    severity: 'caution',
    groupA: ['st john', 'st. john', 'зверобо', 'hypericum'],
    groupB: ['sertraline', 'золофт', 'fluoxetine', 'прозак', 'флуоксетин', 'escitalopram', 'эсциталопрам', 'citalopram', 'циталопрам', 'paroxetine', 'пароксетин', 'fluvoxamine', 'флувоксамин', '5-htp', '5htp', 'триптофан', 'tryptophan'],
    sameSlotOnly: false,
    title: 'St. John’s wort and serotonergic medications',
    explanation: 'St. John’s wort combined with SSRIs or serotonin precursors can increase serotonin-syndrome risk and affect how many medications are metabolized.',
    suggestion: 'Do not combine without explicit clinician approval; tell your clinician about all herbal supplements.',
    source: 'NCCIH — St. John’s Wort and Depression: https://www.nccih.nih.gov/health/st-johns-wort-and-depression-in-depth',
  },
  {
    id: 'omega3_anticoagulants',
    kind: 'pair',
    severity: 'caution',
    groupA: OMEGA3,
    groupB: ['warfarin', 'варфарин', 'apixaban', 'апиксабан', 'rivaroxaban', 'ривароксабан', 'ксарелто', 'clopidogrel', 'клопидогрел', 'aspirin', 'аспирин', 'ацетилсалицил'],
    sameSlotOnly: false,
    title: 'Omega-3 and anticoagulants/antiplatelets',
    explanation: 'High omega-3 doses may add to the effect of medications that reduce blood clotting.',
    suggestion: 'Tell your clinician if you take omega-3 with anticoagulants; do not change doses on your own.',
    source: 'NIH ODS — Omega-3 Fatty Acids, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  },
  {
    id: 'iron_vitamin_c_synergy',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: VITAMIN_C,
    sameSlotOnly: true,
    title: 'Iron + vitamin C is a helpful pairing',
    explanation: 'Vitamin C improves non-heme iron absorption when taken at the same time.',
    suggestion: 'This same-slot pairing is intentional and useful; no change is needed.',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'empty_stomach_in_meal_slot',
    kind: 'empty_stomach_meal_slot',
    severity: 'caution',
    title: 'Empty-stomach dose lands near a typical meal',
    explanation: 'This item is marked empty stomach but is scheduled during a typical meal slot, so food may reduce absorption.',
    suggestion: 'Move the dose at least 30 minutes before food or at least 2 hours after food. Schedule changes remain manual and under your control.',
    source: 'NIH ODS — Iron (absorption is highest on an empty stomach): https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'levothyroxine_meal_slot',
    kind: 'alias_meal_slot',
    severity: 'caution',
    aliases: LEVOTHYROXINE,
    title: 'Levothyroxine lands near a meal slot',
    explanation: 'Levothyroxine is typically taken on an empty stomach, 30-60 minutes before breakfast; taking it with food reduces absorption.',
    suggestion: 'Move it 30-60 minutes before the first meal, manually and in agreement with your clinician.',
    source: 'FDA label — SYNTHROID (levothyroxine sodium), Dosage and Administration; via DailyMed: https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=synthroid',
  },
  {
    id: 'calcium_single_dose_limit',
    kind: 'single_dose_limit',
    severity: 'info',
    aliases: CALCIUM,
    nutrientToken: 'calcium',
    maxAmount: 500,
    unit: 'mg',
    title: 'Single calcium dose above 500 mg',
    explanation: 'Calcium absorption is most efficient at single doses of 500 mg or less of elemental calcium; larger doses are absorbed less efficiently.',
    suggestion: 'Split the daily amount into multiple doses of 500 mg or less.',
    source: 'NIH ODS — Calcium, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  },
  {
    id: 'magnesium_single_dose_limit',
    kind: 'single_dose_limit',
    severity: 'info',
    aliases: MAGNESIUM,
    nutrientToken: 'magnesium',
    maxAmount: 350,
    unit: 'mg',
    title: 'Magnesium dose above 350 mg',
    explanation: '350 mg/day is the tolerable upper intake level for supplemental magnesium; exceeding it often causes GI effects such as diarrhea.',
    suggestion: 'Check the total supplemental magnesium dose; if it exceeds the UL, discuss it with a clinician.',
    source: 'NIH ODS — Magnesium, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
  },
];
