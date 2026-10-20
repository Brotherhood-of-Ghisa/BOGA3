import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BogaAgentApi } from '../src/api-client.js';
import { buildBogaMcpServer } from '../src/tools.js';

describe('MCP tool-list change notifications', () => {
  it('notifies a connected standard client and lets it rediscover a newly registered tool', async () => {
    // This proves the SDK/BoGa server behaviour on a persistent transport.
    // BoGa's production HTTP transport is stateless and cannot deliver this
    // notification across separate POST requests.
    const server = buildBogaMcpServer(new BogaAgentApi({
      baseUrl: new URL('http://127.0.0.1:55531/functions/v1/agent-api/'),
      timeoutMs: 1_000,
    }));
    const refreshedLists: string[][] = [];
    const refreshErrors: Error[] = [];
    const client = new Client(
      { name: 'boga-list-change-test', version: '1.0.0' },
      {
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 0,
            onChanged: (error, tools) => {
              if (error) {
                refreshErrors.push(error);
              } else {
                refreshedLists.push((tools ?? []).map((tool) => tool.name));
              }
            },
          },
        },
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
      const before = await client.listTools();
      expect(before.tools).toHaveLength(14);
      expect(before.tools.some((tool) => tool.name === 'boga_list_change_probe')).toBe(false);

      // Only a test-only tool is registered: no user data or production
      // definition changes. The SDK emits notifications/tools/list_changed.
      server.registerTool(
        'boga_list_change_probe',
        {
          description: 'Test-only probe for dynamic tool discovery.',
          inputSchema: z.object({}).strict(),
        },
        async () => ({ content: [{ type: 'text', text: 'ready' }] }),
      );

      await vi.waitFor(() => {
        expect(refreshErrors).toEqual([]);
        expect(refreshedLists.some((names) => names.includes('boga_list_change_probe'))).toBe(true);
      }, { timeout: 3_000 });

      const after = await client.listTools();
      expect(after.tools).toHaveLength(before.tools.length + 1);
      expect(after.tools.some((tool) => tool.name === 'boga_list_change_probe')).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
