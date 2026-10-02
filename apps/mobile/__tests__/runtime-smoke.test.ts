/* eslint-disable import/first */

const mockInsertSmokeRecord = jest.fn();
const mockListSmokeRecords = jest.fn();

jest.mock('@/src/data/smoke-records', () => ({
  insertSmokeRecord: (...args: unknown[]) => mockInsertSmokeRecord(...args),
  listSmokeRecords: (...args: unknown[]) => mockListSmokeRecords(...args),
}));

import { runLocalDataRuntimeSmoke } from '@/src/data/runtime-smoke';

describe('runLocalDataRuntimeSmoke', () => {
  beforeEach(() => {
    mockInsertSmokeRecord.mockReset();
    mockListSmokeRecords.mockReset();
  });

  it('returns success details when insert/read roundtrip succeeds', async () => {
    const insertedRecord = {
      id: 7,
      value: 'runtime-smoke-123',
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    };

    mockInsertSmokeRecord.mockResolvedValue(insertedRecord);
    mockListSmokeRecords.mockResolvedValue([
      {
        id: 6,
        value: 'runtime-smoke-122',
        createdAt: new Date(1_699_999_999_000),
        updatedAt: new Date(1_699_999_999_000),
      },
      insertedRecord,
    ]);

    const result = await runLocalDataRuntimeSmoke();

    expect(result.insertedRecord).toEqual(insertedRecord);
    expect(result.latestValue).toBe(insertedRecord.value);
    expect(result.totalRecords).toBe(2);
  });

  it('throws when latest record does not match inserted record', async () => {
    const insertedRecord = {
      id: 7,
      value: 'runtime-smoke-123',
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    };

    mockInsertSmokeRecord.mockResolvedValue(insertedRecord);
    mockListSmokeRecords.mockResolvedValue([
      {
        id: 7,
        value: 'runtime-smoke-123',
        createdAt: new Date(1_700_000_000_000),
        updatedAt: new Date(1_700_000_000_000),
      },
      {
        id: 8,
        value: 'runtime-smoke-124',
        createdAt: new Date(1_700_000_000_100),
        updatedAt: new Date(1_700_000_000_100),
      },
    ]);

    await expect(runLocalDataRuntimeSmoke()).rejects.toThrow(
      'Runtime smoke read verification failed: latest record does not match inserted record'
    );
  });
});
