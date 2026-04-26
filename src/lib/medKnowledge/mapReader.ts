import { createHash } from 'node:crypto';

import type { MedicationMapItem, MedicationMapItemStatus } from './types';

export type ActiveProtocolRow = {
  id: string;
  user_id: string;
  protocol_id: string;
  status: string | null;
  start_date: string;
  end_date?: string | null;
};

export type ProtocolItemRow = {
  id: string;
  protocol_id: string;
  item_type: string;
  name: string;
  drug_id?: string | null;
  dose_amount?: number | null;
  dose_unit?: string | null;
  dose_form?: string | null;
  route?: string | null;
  frequency_type: string;
  times?: string[] | null;
  with_food?: string | null;
  start_day?: number | null;
  end_day?: number | null;
};

export type DrugRow = {
  id: string;
  name: string;
  generic_name?: string | null;
};

export type BuildMedicationMapItemsInput = {
  windowStart: string;
  windowEnd: string;
  activeProtocols: ActiveProtocolRow[];
  protocolItems: ProtocolItemRow[];
  drugs: DrugRow[];
};

const VALID_STATUSES = new Set<MedicationMapItemStatus>(['active', 'paused', 'completed', 'abandoned', 'unknown']);

export function buildMedicationMapItems(input: BuildMedicationMapItemsInput): MedicationMapItem[] {
  const drugsById = new Map(input.drugs.map((drug) => [drug.id, drug]));
  const protocolItemsByProtocolId = groupProtocolItems(input.protocolItems);

  return input.activeProtocols
    .filter((activeProtocol) => intersectsDateWindow(activeProtocol.start_date, activeProtocol.end_date ?? null, input.windowStart, input.windowEnd))
    .flatMap((activeProtocol) => {
      const protocolItems = protocolItemsByProtocolId.get(activeProtocol.protocol_id) ?? [];

      return protocolItems
        .filter((protocolItem) => protocolItem.item_type === 'medication')
        .map((protocolItem) => ({
          protocolItem,
          itemWindow: deriveMedicationItemWindow(activeProtocol, protocolItem),
        }))
        .filter(({ itemWindow }) => intersectsDateWindow(itemWindow.startDate, itemWindow.endDate, input.windowStart, input.windowEnd))
        .map(({ protocolItem, itemWindow }) => buildMedicationMapItem(activeProtocol, protocolItem, itemWindow, drugsById.get(protocolItem.drug_id ?? '')));
    });
}

function buildMedicationMapItem(
  activeProtocol: ActiveProtocolRow,
  protocolItem: ProtocolItemRow,
  itemWindow: MedicationItemWindow,
  drug: DrugRow | undefined,
): MedicationMapItem {
  const item: MedicationMapItem = {
    userId: activeProtocol.user_id,
    activeProtocolId: activeProtocol.id,
    protocolItemId: protocolItem.id,
    drugId: protocolItem.drug_id ?? null,
    displayName: drug?.name ?? drug?.generic_name ?? protocolItem.name,
    genericName: drug?.generic_name ?? null,
    doseAmount: protocolItem.dose_amount ?? null,
    doseUnit: protocolItem.dose_unit ?? null,
    doseForm: protocolItem.dose_form ?? null,
    route: protocolItem.route ?? null,
    frequencyType: protocolItem.frequency_type,
    times: protocolItem.times ?? [],
    withFood: protocolItem.with_food ?? null,
    startDate: itemWindow.startDate,
    endDate: itemWindow.endDate,
    status: normalizeStatus(activeProtocol.status),
    sourceHash: '',
  };

  return {
    ...item,
    sourceHash: hashMedicationMapItem(item),
  };
}

type MedicationItemWindow = {
  startDate: string;
  endDate: string | null;
};

function deriveMedicationItemWindow(activeProtocol: ActiveProtocolRow, protocolItem: ProtocolItemRow): MedicationItemWindow {
  const startDate = addUtcDays(activeProtocol.start_date, Math.max((protocolItem.start_day ?? 1) - 1, 0));
  const itemEndDate = protocolItem.end_day ? addUtcDays(activeProtocol.start_date, Math.max(protocolItem.end_day - 1, 0)) : null;

  return {
    startDate,
    endDate: minDateString(itemEndDate, activeProtocol.end_date ?? null),
  };
}

function groupProtocolItems(protocolItems: ProtocolItemRow[]): Map<string, ProtocolItemRow[]> {
  const grouped = new Map<string, ProtocolItemRow[]>();
  for (const protocolItem of protocolItems) {
    grouped.set(protocolItem.protocol_id, [...(grouped.get(protocolItem.protocol_id) ?? []), protocolItem]);
  }
  return grouped;
}

function normalizeStatus(status: string | null): MedicationMapItemStatus {
  return VALID_STATUSES.has(status as MedicationMapItemStatus) ? status as MedicationMapItemStatus : 'unknown';
}

function intersectsDateWindow(startDate: string, endDate: string | null, windowStart: string, windowEnd: string): boolean {
  return startDate <= windowEnd && (endDate === null || endDate >= windowStart);
}

function addUtcDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDateString(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
}

function hashMedicationMapItem(item: MedicationMapItem): string {
  const { sourceHash: _sourceHash, ...hashable } = item;
  return createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
}
