import { prisma } from './client.js';

/**
 * Resolves if the database is reachable and migrated, throws otherwise.
 * Querying `user` (rather than just opening a connection) means "reachable
 * but unmigrated" (relation does not exist) is distinguishable from
 * "unreachable" (connection error) by whoever calls this. `user` replaces the
 * retired `_scaffold_probe` table now that spec 006 has landed real schema.
 */
export async function checkDatabaseHealth(): Promise<void> {
  await prisma.user.count();
}
