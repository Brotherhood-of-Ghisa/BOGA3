// The worker cap agents set on a busy machine (docs/testing/local-test-timings.md).
const loadConfig = (value: string | undefined): Record<string, unknown> => {
  const previous = process.env.BOGA_JEST_MAX_WORKERS;
  if (value === undefined) delete process.env.BOGA_JEST_MAX_WORKERS;
  else process.env.BOGA_JEST_MAX_WORKERS = value;
  try {
    let config: Record<string, unknown> = {};
    jest.isolateModules(() => {
      config = require('../jest.config.js');
    });
    return config;
  } finally {
    if (previous === undefined) delete process.env.BOGA_JEST_MAX_WORKERS;
    else process.env.BOGA_JEST_MAX_WORKERS = previous;
  }
};

describe('jest.config maxWorkers', () => {
  it('keeps Jest’s default when BOGA_JEST_MAX_WORKERS is unset or blank', () => {
    expect(loadConfig(undefined)).not.toHaveProperty('maxWorkers');
    expect(loadConfig('  ')).not.toHaveProperty('maxWorkers');
  });

  it.each(['3', '25%'])('passes %s through as maxWorkers', value => {
    expect(loadConfig(value)).toHaveProperty('maxWorkers', value);
  });

  it.each(['three', '0', '-2', '3.5'])('rejects %s instead of passing it to Jest', value => {
    expect(() => loadConfig(value)).toThrow('BOGA_JEST_MAX_WORKERS must be a worker count or a percentage');
  });
});
