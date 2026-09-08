import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { disconnectDatabase } from '@fp/persistence';

/**
 * Binds @fp/persistence's framework-free shutdown function to NestJS's
 * lifecycle. The adapter lives here, in the composition root, so the
 * persistence package stays free of the HTTP framework (ARCHITECTURE.md §8).
 *
 * Only runs if `app.enableShutdownHooks()` has been called — see main.ts for
 * why that is mandatory in a container (FR-009).
 */
@Injectable()
export class PersistenceLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(PersistenceLifecycle.name);

  async onModuleDestroy(): Promise<void> {
    await disconnectDatabase();
    this.logger.log('Database connections released.');
  }
}
