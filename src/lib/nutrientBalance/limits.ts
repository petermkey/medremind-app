// Curated reference intakes (RDA/AI) and tolerable upper limits (UL) for the
// Nutrient Balance engine. Versioned in-repo, each row cited. NEVER
// LLM-generated at runtime - the excess bucket depends on these being
// human-curated (B1 safety rule). Values are adult male 19-50 unless noted;
// per-user protein/fiber targets from nutrition_target_profiles override the
// macro rows at engine level.
// Zero imports (leaf module for the standalone test:unit harness).

export type NutrientUnit = 'g' | 'mg' | 'mcg';

/**
 * 'total' - UL applies to food + supplements combined.
 * 'supplemental' - UL applies to supplemental intake only (e.g. magnesium,
 * niacin, folic acid, vitamin E per NIH ODS).
 */
export type UlScope = 'total' | 'supplemental';

export type NutrientDef = {
  key: string;
  label: string;
  unit: NutrientUnit;
  aliases: string[];
  rda: number | null;
  ul: number | null;
  ulScope: UlScope;
  source: string;
};

export const NUTRIENT_LIMITS_VERSION = 'nb-limits-2026-07-18.1';

const ODS = 'NIH ODS Fact Sheet for Health Professionals';

export const NUTRIENT_DEFS: NutrientDef[] = [
  { key: 'proteinG', label: 'Protein', unit: 'g', aliases: ['protein'], rda: 56, ul: null, ulScope: 'total', source: 'IOM DRI 2005: RDA 0.8 g/kg (~56 g, 70 kg adult male); no UL set' },
  { key: 'fiberG', label: 'Fiber', unit: 'g', aliases: ['fiber', 'dietaryfiber', 'fibre'], rda: 38, ul: null, ulScope: 'total', source: 'IOM DRI 2005: AI 38 g/day men 19-50; no UL set' },
  { key: 'omega3EpaDhaMg', label: 'Omega-3 (EPA+DHA)', unit: 'mg', aliases: ['omega3', 'epadha', 'epadhamg', 'fishoil', 'epa', 'dha'], rda: 250, ul: 5000, ulScope: 'supplemental', source: 'EFSA 2010 AI 250 mg EPA+DHA; EFSA 2012 opinion: supplemental EPA+DHA up to 5 g/day raises no safety concern' },
  { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', aliases: ['vitamina', 'retinol', 'vitaminamcg'], rda: 900, ul: 3000, ulScope: 'total', source: `${ODS} Vitamin A 2022: RDA 900 mcg RAE men; UL 3000 mcg preformed` },
  { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', aliases: ['vitaminc', 'ascorbicacid'], rda: 90, ul: 2000, ulScope: 'total', source: `${ODS} Vitamin C 2021: RDA 90 mg men; UL 2000 mg` },
  { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', aliases: ['vitamind', 'vitamind3', 'cholecalciferol'], rda: 15, ul: 100, ulScope: 'total', source: `${ODS} Vitamin D 2024: RDA 15 mcg (600 IU) 19-70; UL 100 mcg (4000 IU)` },
  { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', aliases: ['vitamine', 'tocopherol', 'alphatocopherol'], rda: 15, ul: 1000, ulScope: 'supplemental', source: `${ODS} Vitamin E 2021: RDA 15 mg; UL 1000 mg applies to supplemental alpha-tocopherol` },
  { key: 'vitaminKMcg', label: 'Vitamin K', unit: 'mcg', aliases: ['vitamink', 'phylloquinone', 'menaquinone', 'vitamink2'], rda: 120, ul: null, ulScope: 'total', source: `${ODS} Vitamin K 2021: AI 120 mcg men; no UL set` },
  { key: 'thiaminMg', label: 'Thiamin (B1)', unit: 'mg', aliases: ['thiamin', 'thiamine', 'vitaminb1'], rda: 1.2, ul: null, ulScope: 'total', source: `${ODS} Thiamin 2021: RDA 1.2 mg men; no UL set` },
  { key: 'riboflavinMg', label: 'Riboflavin (B2)', unit: 'mg', aliases: ['riboflavin', 'vitaminb2'], rda: 1.3, ul: null, ulScope: 'total', source: `${ODS} Riboflavin 2022: RDA 1.3 mg men; no UL set` },
  { key: 'niacinMg', label: 'Niacin (B3)', unit: 'mg', aliases: ['niacin', 'vitaminb3', 'nicotinamide', 'nicotinicacid'], rda: 16, ul: 35, ulScope: 'supplemental', source: `${ODS} Niacin 2022: RDA 16 mg NE men; UL 35 mg applies to supplemental forms` },
  { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', aliases: ['vitaminb6', 'pyridoxine'], rda: 1.3, ul: 100, ulScope: 'total', source: `${ODS} Vitamin B6 2023: RDA 1.3 mg 19-50; UL 100 mg` },
  { key: 'folateMcg', label: 'Folate', unit: 'mcg', aliases: ['folate', 'folicacid', 'vitaminb9', 'methylfolate'], rda: 400, ul: 1000, ulScope: 'supplemental', source: `${ODS} Folate 2022: RDA 400 mcg DFE; UL 1000 mcg applies to folic acid from fortified food/supplements` },
  { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', aliases: ['vitaminb12', 'cobalamin', 'methylcobalamin', 'cyanocobalamin'], rda: 2.4, ul: null, ulScope: 'total', source: `${ODS} Vitamin B12 2024: RDA 2.4 mcg; no UL set` },
  { key: 'biotinMcg', label: 'Biotin', unit: 'mcg', aliases: ['biotin', 'vitaminb7'], rda: 30, ul: null, ulScope: 'total', source: `${ODS} Biotin 2022: AI 30 mcg; no UL set` },
  { key: 'pantothenicAcidMg', label: 'Pantothenic acid (B5)', unit: 'mg', aliases: ['pantothenicacid', 'vitaminb5', 'pantothenate'], rda: 5, ul: null, ulScope: 'total', source: `${ODS} Pantothenic Acid 2021: AI 5 mg; no UL set` },
  { key: 'cholineMg', label: 'Choline', unit: 'mg', aliases: ['choline'], rda: 550, ul: 3500, ulScope: 'total', source: `${ODS} Choline 2022: AI 550 mg men; UL 3500 mg` },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg', aliases: ['calcium'], rda: 1000, ul: 2500, ulScope: 'total', source: `${ODS} Calcium 2024: RDA 1000 mg 19-50; UL 2500 mg` },
  { key: 'ironMg', label: 'Iron', unit: 'mg', aliases: ['iron'], rda: 8, ul: 45, ulScope: 'total', source: `${ODS} Iron 2024: RDA 8 mg men; UL 45 mg` },
  { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', aliases: ['magnesium', 'magnesiumcitrate', 'magnesiumglycinate'], rda: 420, ul: 350, ulScope: 'supplemental', source: `${ODS} Magnesium 2022: RDA 420 mg men 31+; UL 350 mg applies to supplemental magnesium only` },
  { key: 'zincMg', label: 'Zinc', unit: 'mg', aliases: ['zinc', 'zincpicolinate'], rda: 11, ul: 40, ulScope: 'total', source: `${ODS} Zinc 2022: RDA 11 mg men; UL 40 mg` },
  { key: 'copperMg', label: 'Copper', unit: 'mg', aliases: ['copper'], rda: 0.9, ul: 10, ulScope: 'total', source: `${ODS} Copper 2022: RDA 0.9 mg; UL 10 mg` },
  { key: 'manganeseMg', label: 'Manganese', unit: 'mg', aliases: ['manganese'], rda: 2.3, ul: 11, ulScope: 'total', source: `${ODS} Manganese 2021: AI 2.3 mg men; UL 11 mg` },
  { key: 'seleniumMcg', label: 'Selenium', unit: 'mcg', aliases: ['selenium'], rda: 55, ul: 400, ulScope: 'total', source: `${ODS} Selenium 2021: RDA 55 mcg; UL 400 mcg` },
  { key: 'iodineMcg', label: 'Iodine', unit: 'mcg', aliases: ['iodine', 'potassiumiodide'], rda: 150, ul: 1100, ulScope: 'total', source: `${ODS} Iodine 2024: RDA 150 mcg; UL 1100 mcg` },
  { key: 'potassiumMg', label: 'Potassium', unit: 'mg', aliases: ['potassium'], rda: 3400, ul: null, ulScope: 'total', source: `${ODS} Potassium 2022: AI 3400 mg men; no UL set` },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', aliases: ['sodium', 'salt'], rda: 1500, ul: 2300, ulScope: 'total', source: 'DGA 2020-2025 / NASEM 2019: AI 1500 mg; CDRR 2300 mg treated as the excess limit' },
  { key: 'phosphorusMg', label: 'Phosphorus', unit: 'mg', aliases: ['phosphorus'], rda: 700, ul: 4000, ulScope: 'total', source: `${ODS} Phosphorus 2023: RDA 700 mg; UL 4000 mg` },
  { key: 'chromiumMcg', label: 'Chromium', unit: 'mcg', aliases: ['chromium', 'chromiumpicolinate'], rda: 35, ul: null, ulScope: 'total', source: `${ODS} Chromium 2022: AI 35 mcg men 19-50; no UL set` },
  { key: 'molybdenumMcg', label: 'Molybdenum', unit: 'mcg', aliases: ['molybdenum'], rda: 45, ul: 2000, ulScope: 'total', source: `${ODS} Molybdenum 2022: RDA 45 mcg; UL 2000 mcg` },
];

function normalizeKey(rawKey: string): string {
  return rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const DEF_INDEX = new Map<string, NutrientDef>();
for (const def of NUTRIENT_DEFS) {
  DEF_INDEX.set(normalizeKey(def.key), def);
  for (const alias of def.aliases) DEF_INDEX.set(normalizeKey(alias), def);
}
// Extra alias for the common combined key shape used by food LLM output.
DEF_INDEX.set(normalizeKey('epaDhaMg'), DEF_INDEX.get(normalizeKey('omega3EpaDhaMg'))!);

export function findNutrientDef(rawKey: string): NutrientDef | null {
  return DEF_INDEX.get(normalizeKey(rawKey)) ?? null;
}
