import type { MedicationNormalization } from './types';

type NormalizeMedicationInput = {
  medicationMapItemId: string;
  displayName: string;
  genericName?: string | null;
};

type FetchOptions = {
  fetchImpl?: typeof fetch;
};

export type RxNormApproximateCandidate = {
  rxcui: string;
  name?: string;
  score?: string;
};

type LocalMedicationRule = {
  aliases: string[];
  normalizedName: string;
  ingredients: string[];
  classCodes: string[];
  classLabels: string[];
};

const LOCAL_MEDICATION_RULES: LocalMedicationRule[] = [
  {
    aliases: ['semaglutide', 'ozempic', 'wegovy', 'rybelsus'],
    normalizedName: 'semaglutide',
    ingredients: ['semaglutide'],
    classCodes: ['GLP1'],
    classLabels: ['GLP-1 receptor agonist'],
  },
  {
    aliases: ['testosterone', 'testosterone cypionate', 'testosterone enanthate'],
    normalizedName: 'testosterone',
    ingredients: ['testosterone'],
    classCodes: ['ANDROGEN'],
    classLabels: ['androgen'],
  },
  {
    aliases: ['levothyroxine', 'synthroid', 'levoxyl'],
    normalizedName: 'levothyroxine',
    ingredients: ['levothyroxine'],
    classCodes: ['THYROID_HORMONE'],
    classLabels: ['thyroid hormone'],
  },
  {
    aliases: ['sertraline', 'fluoxetine', 'escitalopram', 'citalopram', 'paroxetine', 'fluvoxamine'],
    normalizedName: 'selective serotonin reuptake inhibitor',
    ingredients: [],
    classCodes: ['SSRI'],
    classLabels: ['SSRI', 'selective serotonin reuptake inhibitor'],
  },
];

export async function normalizeMedicationFromLocalRules(input: NormalizeMedicationInput): Promise<MedicationNormalization> {
  const candidateText = normalizeSearchText([input.displayName, input.genericName].filter(Boolean).join(' '));
  const matchedRule = LOCAL_MEDICATION_RULES.find((rule) => rule.aliases.some((alias) => candidateText.includes(alias)));

  if (matchedRule) {
    return {
      medicationMapItemId: input.medicationMapItemId,
      rxnormRxcui: null,
      normalizedName: matchedRule.normalizedName,
      ingredients: matchedRule.ingredients,
      classCodes: matchedRule.classCodes,
      classLabels: matchedRule.classLabels,
      source: 'local_alias',
      confidence: 0.95,
      ambiguityNotes: null,
    };
  }

  return {
    medicationMapItemId: input.medicationMapItemId,
    rxnormRxcui: null,
    normalizedName: null,
    ingredients: [],
    classCodes: [],
    classLabels: [],
    source: 'manual',
    confidence: 0.2,
    ambiguityNotes: 'No deterministic local classification found; manual review required.',
  };
}

export async function lookupRxNormApproximate(
  name: string,
  options: FetchOptions = {},
): Promise<RxNormApproximateCandidate[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const url = new URL('https://rxnav.nlm.nih.gov/REST/approximateTerm.json');
  url.searchParams.set('term', name);
  url.searchParams.set('maxEntries', '5');

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`RxNorm approximate lookup failed with status ${response.status}`);
  }

  const payload = await response.json();
  const candidates = payload?.approximateGroup?.candidate;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .filter((candidate): candidate is RxNormApproximateCandidate => typeof candidate?.rxcui === 'string')
    .map((candidate) => ({
      rxcui: candidate.rxcui,
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      score: typeof candidate.score === 'string' ? candidate.score : undefined,
    }));
}

export async function lookupRxClassByRxcui(rxcui: string, options: FetchOptions = {}): Promise<string[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const url = new URL('https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json');
  url.searchParams.set('rxcui', rxcui);

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`RxClass lookup failed with status ${response.status}`);
  }

  const payload = await response.json();
  const classTypes = payload?.rxclassDrugInfoList?.rxclassDrugInfo;
  if (!Array.isArray(classTypes)) return [];

  return classTypes
    .map((item) => item?.rxclassMinConceptItem?.className)
    .filter((className): className is string => typeof className === 'string');
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
