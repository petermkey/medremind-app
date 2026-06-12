import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDayScheduleForDate } from '../../src/lib/store/daySchedule';
import type { ActiveProtocol, Protocol, ScheduledDose } from '../../src/types';

const TODAY = '2026-06-13';
const YESTERDAY = '2026-06-12';

const protocol: Protocol = {
  id: 'p1',
  name: 'Test',
  category: 'custom',
  isTemplate: false,
  isArchived: false,
  items: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeInstance(id: string, status: ActiveProtocol['status']): ActiveProtocol {
  return {
    id,
    userId: 'u1',
    protocolId: protocol.id,
    protocol,
    status,
    startDate: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeDose(
  id: string,
  activeProtocolId: string,
  scheduledDate: string,
  status: ScheduledDose['status'],
): ScheduledDose {
  return {
    id,
    userId: 'u1',
    activeProtocolId,
    protocolItemId: 'item1',
    scheduledDate,
    scheduledTime: '08:00',
    status,
  } as ScheduledDose;
}

const instances = [makeInstance('active-1', 'active'), makeInstance('paused-1', 'paused')];

test('past days keep handled doses from any instance but drop pending of inactive ones', () => {
  const doses = [
    makeDose('a', 'active-1', YESTERDAY, 'pending'),
    makeDose('b', 'paused-1', YESTERDAY, 'pending'),
    makeDose('c', 'paused-1', YESTERDAY, 'taken'),
    makeDose('d', 'paused-1', YESTERDAY, 'skipped'),
  ];
  const result = getDayScheduleForDate(doses, instances, YESTERDAY, TODAY).map(d => d.id);
  assert.deepEqual(result.sort(), ['a', 'c', 'd']);
});

test('today and future only show doses of active instances', () => {
  const doses = [
    makeDose('a', 'active-1', TODAY, 'pending'),
    makeDose('b', 'paused-1', TODAY, 'pending'),
    makeDose('c', 'paused-1', TODAY, 'taken'),
  ];
  const result = getDayScheduleForDate(doses, instances, TODAY, TODAY).map(d => d.id);
  assert.deepEqual(result, ['a']);
});
