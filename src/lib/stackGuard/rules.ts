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

export const NUTRIENT_LABELS_RU: Record<string, string> = {
  iron: 'железо',
  calcium: 'кальций',
  magnesium: 'магний',
  zinc: 'цинк',
  copper: 'медь',
  vitamin_d: 'витамин D',
  omega3: 'омега-3',
  vitamin_c: 'витамин C',
  b12: 'витамин B12',
  folate: 'фолат',
  melatonin: 'мелатонин',
  potassium: 'калий',
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
    title: 'Железо и кальций в один приём',
    explanation: 'Кальций снижает всасывание железа при одновременном приёме — часть дозы железа усваивается впустую.',
    suggestion: 'Разнесите приёмы минимум на 2 часа (например, железо утром натощак, кальций вечером).',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'iron_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Железо и цинк в один приём',
    explanation: 'Железо и цинк конкурируют за всасывание, особенно натощак в виде растворов/добавок.',
    suggestion: 'По возможности принимайте железо и цинк в разные приёмы или с интервалом ≥2 часа.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'iron_magnesium_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: MAGNESIUM,
    sameSlotOnly: true,
    title: 'Железо и магний в один приём',
    explanation: 'Магнийсодержащие препараты (в т.ч. оксид магния) снижают всасывание железа при совместном приёме.',
    suggestion: 'Разнесите железо и магний по разным приёмам (≥2 часа).',
    source: 'Campbell NR, Hasinoff BB. Iron supplements: a common cause of drug interactions. Br J Clin Pharmacol. 1991;31(3):251-255.',
  },
  {
    id: 'calcium_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: CALCIUM,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Кальций и цинк в один приём',
    explanation: 'Высокие дозы кальция могут умеренно снижать всасывание цинка при одновременном приёме.',
    suggestion: 'Если оба нужны ежедневно — принимайте в разные слоты дня.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'zinc_copper_balance',
    kind: 'pair',
    severity: 'caution',
    groupA: ZINC,
    groupB: COPPER,
    sameSlotOnly: false,
    title: 'Цинк подавляет усвоение меди',
    explanation: 'Длительный приём цинка (особенно ≥50 мг/день) снижает всасывание меди и может привести к её дефициту.',
    suggestion: 'Принимайте цинк и медь в разное время; при длительном приёме высоких доз цинка обсудите баланс меди с врачом.',
    source: 'NIH ODS — Zinc: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/ и NIH ODS — Copper: https://ods.od.nih.gov/factsheets/Copper-HealthProfessional/',
  },
  {
    id: 'levothyroxine_mineral_spacing',
    kind: 'pair',
    severity: 'caution',
    groupA: LEVOTHYROXINE,
    groupB: [...IRON, ...CALCIUM, ...MAGNESIUM],
    sameSlotOnly: false,
    title: 'Левотироксин и минералы (железо/кальций/магний)',
    explanation: 'Железо, кальций и магний связывают левотироксин в ЖКТ и заметно снижают его всасывание — даже при приёме в пределах нескольких часов.',
    suggestion: 'Принимайте левотироксин минимум за 4 часа до/после железа, кальция и магния.',
    source: 'FDA label — SYNTHROID (levothyroxine sodium), Drug Interactions; NIH ODS — Calcium: https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  },
  {
    id: 'sjw_serotonergic',
    kind: 'pair',
    severity: 'caution',
    groupA: ['st john', 'st. john', 'зверобо', 'hypericum'],
    groupB: ['sertraline', 'золофт', 'fluoxetine', 'прозак', 'флуоксетин', 'escitalopram', 'эсциталопрам', 'citalopram', 'циталопрам', 'paroxetine', 'пароксетин', 'fluvoxamine', 'флувоксамин', '5-htp', '5htp', 'триптофан', 'tryptophan'],
    sameSlotOnly: false,
    title: 'Зверобой и серотонинергические препараты',
    explanation: 'Зверобой в сочетании с СИОЗС/предшественниками серотонина повышает риск серотонинового синдрома и меняет метаболизм многих лекарств.',
    suggestion: 'Не сочетайте без явного одобрения врача; сообщите врачу обо всех растительных добавках.',
    source: 'NCCIH — St. John’s Wort and Depression: https://www.nccih.nih.gov/health/st-johns-wort-and-depression-in-depth',
  },
  {
    id: 'omega3_anticoagulants',
    kind: 'pair',
    severity: 'caution',
    groupA: OMEGA3,
    groupB: ['warfarin', 'варфарин', 'apixaban', 'апиксабан', 'rivaroxaban', 'ривароксабан', 'ксарелто', 'clopidogrel', 'клопидогрел', 'aspirin', 'аспирин', 'ацетилсалицил'],
    sameSlotOnly: false,
    title: 'Омега-3 и антикоагулянты/антиагреганты',
    explanation: 'Высокие дозы омега-3 могут усиливать эффект препаратов, снижающих свёртываемость крови.',
    suggestion: 'Сообщите врачу о приёме омега-3 вместе с антикоагулянтами; не меняйте дозы самостоятельно.',
    source: 'NIH ODS — Omega-3 Fatty Acids, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  },
  {
    id: 'iron_vitamin_c_synergy',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: VITAMIN_C,
    sameSlotOnly: true,
    title: 'Железо + витамин C — удачное сочетание',
    explanation: 'Витамин C улучшает всасывание негемового железа при одновременном приёме.',
    suggestion: 'Это сочетание в одном слоте — осознанно хорошее; менять ничего не нужно.',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'empty_stomach_in_meal_slot',
    kind: 'empty_stomach_meal_slot',
    severity: 'caution',
    title: 'Приём «натощак» попадает на типичное время еды',
    explanation: 'Элемент помечен «натощак», но запланирован на типичный слот приёма пищи (завтрак/обед/ужин) — еда может снизить его усвоение.',
    suggestion: 'Сдвиньте время приёма на ≥30 минут до еды или ≥2 часа после (правка расписания — вручную, по вашему решению).',
    source: 'NIH ODS — Iron (absorption is highest on an empty stomach): https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'levothyroxine_meal_slot',
    kind: 'alias_meal_slot',
    severity: 'caution',
    aliases: LEVOTHYROXINE,
    title: 'Левотироксин в слот приёма пищи',
    explanation: 'Левотироксин рекомендуется принимать натощак, за 30–60 минут до завтрака — приём во время еды снижает всасывание.',
    suggestion: 'Перенесите приём на 30–60 минут до первого приёма пищи (вручную, по согласованию с врачом).',
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
    title: 'Разовая доза кальция выше 500 мг',
    explanation: 'Всасывание кальция наиболее эффективно при разовых дозах ≤500 мг элементарного кальция; большие дозы усваиваются хуже.',
    suggestion: 'Разбейте дневную дозу на несколько приёмов по ≤500 мг.',
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
    title: 'Доза магния выше 350 мг',
    explanation: '350 мг/день — верхний допустимый уровень (UL) для магния из добавок; превышение часто даёт ЖКТ-эффекты (диарея).',
    suggestion: 'Проверьте суммарную дозу магния из добавок; при превышении UL обсудите с врачом.',
    source: 'NIH ODS — Magnesium, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
  },
];
