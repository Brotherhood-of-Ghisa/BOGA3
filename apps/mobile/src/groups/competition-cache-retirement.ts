import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { deleteAccountCompetitionCache, getCompetitionCacheGeneration, quarantineCompetitionCache,quarantineCompetitionGroup } from './cache';

/** Synchronous memory retirement precedes asynchronous disk cleanup. Quarantine
 * prevents old disk rows hydrating if bootstrap or deletion fails. */
export function retireCompetitionAccount(userId: string,groupId?: string): Promise<void> {
  const generation=groupId?quarantineCompetitionGroup(userId,groupId):quarantineCompetitionCache(userId);
  return (async () => {
    try {
      const database=await bootstrapLocalDataLayer();
      if (getCompetitionCacheGeneration(userId) === generation) deleteAccountCompetitionCache(database,userId);
    } catch { /* The caller shows the original protocol failure; quarantine stays in force. */ }
  })();
}
