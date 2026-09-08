import { Controller, Get, HttpCode, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { checkDatabaseHealth } from '@fp/persistence';

interface HealthOk {
  status: 'ok';
}

interface HealthError {
  status: 'error';
}

/**
 * Deliberately carries no detail. `/health/ready` is unauthenticated and, on
 * the staging environment, openly reachable (spec 003 FR-014), so anything in
 * this body is public. The underlying driver error names the database host,
 * port and database name — that is internal topology, and it belongs in the
 * log, not in the response. The correlating detail is written server-side by
 * the controller below.
 */
class ReadinessError extends HttpException {
  constructor() {
    super({ status: 'error' } satisfies HealthError, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  @Get()
  liveness(): HealthOk {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness(): Promise<HealthOk> {
    try {
      await checkDatabaseHealth();
      return { status: 'ok' };
    } catch (error) {
      this.logger.error(
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ReadinessError();
    }
  }
}
