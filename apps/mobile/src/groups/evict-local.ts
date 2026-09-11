// Drops a group's cached entries from this device after the user leaves it
// (contract §6.2 access loss), so its stream and members do not linger until
// the next refresh.

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { logEvent } from '@/src/logging';

import { evictGroup } from './cache';

/**
 * Never rejects — the leave already succeeded on the server. A failure is
 * logged (`group.evict_failed`); the next refresh's `NOT_FOUND` evicts the
 * entries anyway.
 */
export const evictGroupFromDevice = async (groupId: string): Promise<void> => {
  try {
    evictGroup(await bootstrapLocalDataLayer(), groupId);
  } catch (error) {
    logEvent({
      level: 'warn',
      source: 'app',
      event: 'group.evict_failed',
      message: error instanceof Error ? error.message : 'Unknown group cache eviction failure.',
    });
  }
};
