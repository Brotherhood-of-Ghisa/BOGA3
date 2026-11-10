import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { BogaAgentApiError } from './api-client.js';

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export const tokenFrom = (extra: ToolExtra): string => {
  const token = extra.authInfo?.token;
  if (!token) {
    throw new BogaAgentApiError(401, 'UNAUTHORIZED', 'Authentication required.', null);
  }
  return token;
};

const toolResult = (data: Record<string, unknown>) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(data),
    },
  ],
  structuredContent: data,
});

const toolError = (error: unknown) => {
  const known = error instanceof BogaAgentApiError
    ? error
    : new BogaAgentApiError(500, 'INTERNAL', 'The BoGa tool call failed.', null);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: {
            code: known.code,
            message: known.message,
            request_id: known.requestId,
          },
        }),
      },
    ],
    isError: true,
  };
};

export const invoke = async (
  operation: () => Promise<Record<string, unknown>>,
) => {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolError(error);
  }
};

