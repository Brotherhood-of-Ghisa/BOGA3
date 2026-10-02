/* eslint-disable import/first */

const mockBootstrapLocalDataLayer = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => mockBootstrapLocalDataLayer(),
}));

import { listSmokeRecords, insertSmokeRecord } from '@/src/data/smoke-records';
import { smokeRecords } from '@/src/data/schema/smoke';

describe('smoke records repository', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
  });

  it('inserts a smoke record and returns the latest inserted row', async () => {
    const insertedRecord = {
      id: 1,
      value: 'lane-1-smoke',
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    };

    const runMock = jest.fn();
    const valuesMock = jest.fn(() => ({ run: runMock }));
    const insertMock = jest.fn(() => ({ values: valuesMock }));

    const getMock = jest.fn(() => insertedRecord);
    const orderByMock = jest.fn(() => ({ get: getMock }));
    const fromMock = jest.fn(() => ({ orderBy: orderByMock }));
    const selectMock = jest.fn(() => ({ from: fromMock }));

    mockBootstrapLocalDataLayer.mockResolvedValue({
      insert: insertMock,
      select: selectMock,
    });

    const result = await insertSmokeRecord('lane-1-smoke');

    expect(insertMock).toHaveBeenCalledWith(smokeRecords);
    expect(valuesMock).toHaveBeenCalledWith({ value: 'lane-1-smoke' });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(insertedRecord);
  });

  it('throws when insert succeeds but no row can be read back', async () => {
    const runMock = jest.fn();
    const valuesMock = jest.fn(() => ({ run: runMock }));
    const insertMock = jest.fn(() => ({ values: valuesMock }));

    const getMock = jest.fn(() => undefined);
    const orderByMock = jest.fn(() => ({ get: getMock }));
    const fromMock = jest.fn(() => ({ orderBy: orderByMock }));
    const selectMock = jest.fn(() => ({ from: fromMock }));

    mockBootstrapLocalDataLayer.mockResolvedValue({
      insert: insertMock,
      select: selectMock,
    });

    await expect(insertSmokeRecord('lane-1-smoke')).rejects.toThrow(
      'Smoke record insert succeeded but no record was returned'
    );
  });

  it('lists smoke records ordered by ascending id', async () => {
    const rows = [
      {
        id: 1,
        value: 'first',
        createdAt: new Date(1_700_000_000_000),
        updatedAt: new Date(1_700_000_000_000),
      },
      {
        id: 2,
        value: 'second',
        createdAt: new Date(1_700_000_000_100),
        updatedAt: new Date(1_700_000_000_100),
      },
    ];

    const allMock = jest.fn(() => rows);
    const orderByMock = jest.fn(() => ({ all: allMock }));
    const fromMock = jest.fn(() => ({ orderBy: orderByMock }));
    const selectMock = jest.fn(() => ({ from: fromMock }));

    mockBootstrapLocalDataLayer.mockResolvedValue({
      select: selectMock,
    });

    const result = await listSmokeRecords();

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(rows);
  });
});
