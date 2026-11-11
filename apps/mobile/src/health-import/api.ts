import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';

import { HealthImportError } from './mapping';
import type { ImportedActivity } from './types';

export type HealthImportApplyInput = {
  upserts: ImportedActivity[];
  deletes: string[];
  /** With `completeIds`: the closing call of a fresh backfill. */
  completeSince?: string;
  completeIds?: string[];
};
export type HealthImportApplyResult = { upserted: number; deleted: number; pruned: number };

export type HealthImportApi = {
  apply(input: HealthImportApplyInput): Promise<HealthImportApplyResult>;
};

const isResult = (value: unknown): value is HealthImportApplyResult => {
  const row = value as Partial<HealthImportApplyResult> | null;
  return typeof row?.upserted === 'number' && typeof row.deleted === 'number' && typeof row.pruned === 'number';
};

/** `app_public.health_activities_apply`, the owner-only write path (health-activities contract). */
export const healthImportApi: HealthImportApi = {
  apply: async ({ upserts, deletes, completeSince, completeIds }) => {
    const { data, error } = await getRequiredSupabaseMobileClient().schema('app_public').rpc('health_activities_apply', {
      p_source: 'apple_health',
      p_upserts: upserts,
      p_deletes: deletes,
      ...(completeSince !== undefined ? { p_complete_since: completeSince, p_complete_ids: completeIds ?? [] } : {}),
    });
    if (error) {
      const code = /^(AUTH_REQUIRED|AGENT_FORBIDDEN)\b/.test(error.message) ? 'AUTH_REQUIRED' : 'UPLOAD_FAILED';
      throw new HealthImportError(code, error.message);
    }
    if (!isResult(data)) throw new HealthImportError('UPLOAD_FAILED', 'The server returned an unexpected import result.');
    return data;
  },
};
