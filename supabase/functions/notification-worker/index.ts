import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { handleNotificationRequest, type Rpc } from './handler.ts';

Deno.serve(async (request: Request): Promise<Response> => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // Authentication precedes creating the privileged database client in the handler seam.
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await db.schema('app_public').rpc(name, args);
    if (error) throw new Error('NOTIFICATION_RPC_FAILED');
    return data as T;
  };
  return await handleNotificationRequest(request, { serviceKey, rpc, accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') });
});
