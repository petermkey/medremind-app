import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMedicationMapItems } from './mapReader.ts';

test('buildMedicationMapItems joins medication rows and produces stable source hashes', () => {
  const input = {
    windowStart: '2026-04-01',
    windowEnd: '2026-04-30',
    activeProtocols: [
      {
        id: 'ap-1',
        user_id: 'u-1',
        protocol_id: 'p-1',
        status: 'active',
        start_date: '2026-04-10',
        end_date: '2026-05-10',
      },
    ],
    protocolItems: [
      {
        id: 'pi-1',
        protocol_id: 'p-1',
        item_type: 'medication',
        name: 'Ozempic',
        drug_id: 'd-1',
        dose_amount: 0.25,
        dose_unit: 'mg',
        dose_form: 'injection',
        route: 'subcutaneous',
        frequency_type: 'weekly',
        times: ['08:00'],
        with_food: 'any',
        start_day: 1,
        end_day: 28,
      },
    ],
    drugs: [
      {
        id: 'd-1',
        name: 'Ozempic',
        generic_name: 'semaglutide',
      },
    ],
  };

  const first = buildMedicationMapItems(input);
  const second = buildMedicationMapItems(input);

  assert.equal(first.length, 1);
  assert.equal(first[0].displayName, 'Ozempic');
  assert.equal(first[0].genericName, 'semaglutide');
  assert.equal(first[0].status, 'active');
  assert.equal(first[0].startDate, '2026-04-10');
  assert.equal(first[0].endDate, '2026-05-07');
  assert.equal(first[0].sourceHash, second[0].sourceHash);
});

test('buildMedicationMapItems excludes non-medications and protocols outside the date window', () => {
  const items = buildMedicationMapItems({
    windowStart: '2026-04-01',
    windowEnd: '2026-04-30',
    activeProtocols: [
      {
        id: 'ap-1',
        user_id: 'u-1',
        protocol_id: 'p-1',
        status: 'paused',
        start_date: '2026-04-10',
        end_date: '2026-04-20',
      },
      {
        id: 'ap-2',
        user_id: 'u-1',
        protocol_id: 'p-2',
        status: 'active',
        start_date: '2026-06-01',
        end_date: '2026-06-30',
      },
    ],
    protocolItems: [
      {
        id: 'pi-med',
        protocol_id: 'p-1',
        item_type: 'medication',
        name: 'Levothyroxine',
        frequency_type: 'daily',
        times: ['07:00'],
        start_day: 1,
      },
      {
        id: 'pi-analysis',
        protocol_id: 'p-1',
        item_type: 'analysis',
        name: 'Blood pressure check',
        frequency_type: 'daily',
        times: ['09:00'],
        start_day: 1,
      },
      {
        id: 'pi-future',
        protocol_id: 'p-2',
        item_type: 'medication',
        name: 'Future med',
        frequency_type: 'daily',
        times: ['09:00'],
        start_day: 1,
      },
    ],
    drugs: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].protocolItemId, 'pi-med');
  assert.equal(items[0].status, 'paused');
});

test('buildMedicationMapItems excludes medication items outside the requested date window', () => {
  const items = buildMedicationMapItems({
    windowStart: '2026-04-01',
    windowEnd: '2026-04-30',
    activeProtocols: [
      {
        id: 'ap-1',
        user_id: 'u-1',
        protocol_id: 'p-1',
        status: 'active',
        start_date: '2026-04-01',
        end_date: '2026-12-31',
      },
    ],
    protocolItems: [
      {
        id: 'pi-april',
        protocol_id: 'p-1',
        item_type: 'medication',
        name: 'April medication',
        frequency_type: 'daily',
        times: ['08:00'],
        start_day: 1,
        end_day: 30,
      },
      {
        id: 'pi-july',
        protocol_id: 'p-1',
        item_type: 'medication',
        name: 'July medication',
        frequency_type: 'daily',
        times: ['08:00'],
        start_day: 92,
        end_day: 122,
      },
    ],
    drugs: [],
  });

  assert.deepEqual(items.map((item) => item.protocolItemId), ['pi-april']);
});
