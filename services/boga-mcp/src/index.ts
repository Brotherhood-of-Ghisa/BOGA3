import { loadConfig } from './config.js';
import { createBogaMcpApp } from './server.js';

const config = loadConfig();
const app = await createBogaMcpApp({ config });
const listener = app.listen(config.port, config.host, () => {
  console.log('[boga-mcp] listening', {
    resource: config.resourceUrl.href,
  });
});

const shutdown = (signal: string) => {
  console.log('[boga-mcp] shutting down', { signal });
  listener.close((error) => {
    if (error) {
      console.error('[boga-mcp] shutdown failed', { message: error.message });
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
