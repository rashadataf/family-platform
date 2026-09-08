import { prisma } from './client.js';

/**
 * Resolves if the database is reachable and migrated, throws otherwise.
 * Querying `_scaffold_probe` (rather than just opening a connection) means
 * "reachable but unmigrated" (relation does not exist) is distinguishable
 * from "unreachable" (connection error) by whoever calls this.
 */
export async function checkDatabaseHealth(): Promise<void> {
  await prisma.scaffoldProbe.count();
}
