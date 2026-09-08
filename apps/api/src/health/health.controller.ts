import { Controller, Get, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { checkDatabaseHealth } from '@fp/persistence';

interface HealthOk {
  status: 'ok';
}

interface HealthError {
  status: 'error';
  message: string;
}

class ReadinessError extends HttpException {
  constructor(message: string) {
    super({ status: 'error', message } satisfies HealthError, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

@Controller('health')
export class HealthController {
  @Get()
  liveness(): HealthOk {
    return { status: 'ok' };
  }
  // cache-verification probe: temporary, reverted in the next commit

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness(): Promise<HealthOk> {
    try {
      await checkDatabaseHealth();
      return { status: 'ok' };
    } catch (error) {
      throw new ReadinessError(error instanceof Error ? error.message : String(error));
    }
  }
}
