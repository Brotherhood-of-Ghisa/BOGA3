import { createUncaughtErrorSink } from './helpers/uncaught-react-errors';

describe('createUncaughtErrorSink', () => {
  it('holds nothing until React reports something', () => {
    expect(createUncaughtErrorSink().drain()).toBeNull();
  });

  it('rethrows a lone error as itself, keeping its identity and stack', () => {
    const sink = createUncaughtErrorSink();
    const boom = new TypeError('boom');

    expect(sink.record({ error: boom })).toBe(false);
    const drained = sink.drain();

    expect(drained).toBe(boom);
    expect((drained as Error).stack).toBe(boom.stack);
  });

  it('names every error when one test reports several, dropping none', () => {
    const sink = createUncaughtErrorSink();
    const first = new TypeError('first failure');
    const second = new RangeError('second failure');
    sink.record({ error: first });
    sink.record({ error: second });

    const drained = sink.drain() as AggregateError;

    expect(drained).toBeInstanceOf(AggregateError);
    expect(drained.errors).toEqual([first, second]);
    expect(drained.message).toBe(
      '2 uncaught React errors in one test: TypeError: first failure; RangeError: second failure'
    );
  });

  it('empties itself, so one test never fails the next one', () => {
    const sink = createUncaughtErrorSink();
    sink.record({ error: new Error('mine') });
    sink.record({ error: new Error('also mine') });

    expect(sink.drain()).not.toBeNull();
    expect(sink.drain()).toBeNull();
  });

  it('keeps a report that carries no error, and describes a non-Error throw', () => {
    const sink = createUncaughtErrorSink();
    const bare = { type: 'error' };
    sink.record(bare);
    expect(sink.drain()).toBe(bare);

    sink.record({ error: 'a thrown string' });
    sink.record({ error: undefined });
    expect((sink.drain() as AggregateError).message).toBe(
      '2 uncaught React errors in one test: a thrown string; undefined'
    );
  });
});
