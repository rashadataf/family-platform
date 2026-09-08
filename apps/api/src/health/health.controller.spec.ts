import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const { checkDatabaseHealth } = vi.hoisted(() => ({ checkDatabaseHealth: vi.fn() }));
vi.mock('@fp/persistence', () => ({ checkDatabaseHealth }));

const { HealthController } = await import('./health.controller.js');

/**
 * `/health/ready` is unauthenticated, and on the staging environment it is
 * openly reachable with no access gate (spec 003 FR-014). Anything this
 * endpoint returns is therefore public. The database driver's own error text
 * names the host, port and database — internal topology that must reach the
 * log and nothing else. These tests exist to make that a regression, not a
 * judgement call, the next time someone finds the empty body unhelpful.
 */
const LEAKY_DRIVER_ERROR =
  "Can't reach database server at `postgres-internal.vps.example:5432`. Database `family_platform_staging` is unavailable.";

/** Narrows without a type assertion, so Principle I's `as` rule stays intact. */
function expectHttpException(value: unknown): HttpException {
  if (!(value instanceof HttpException)) {
    throw new Error(`Expected readiness to reject with an HttpException, got: ${String(value)}`);
  }
  return value;
}

describe('HealthController', () => {
  let controller: InstanceType<typeof HealthController>;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new HealthController();
  });

  describe('liveness', () => {
    it('reports ok without consulting the database', () => {
      expect(controller.liveness()).toEqual({ status: 'ok' });
      expect(checkDatabaseHealth).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports ok when the database is reachable and migrated', async () => {
      checkDatabaseHealth.mockResolvedValue(undefined);

      await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
    });

    it('answers 503 when the database is unreachable', async () => {
      checkDatabaseHealth.mockRejectedValue(new Error(LEAKY_DRIVER_ERROR));
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const error = expectHttpException(await controller.readiness().catch((c: unknown) => c));

      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('discloses no internal detail in the public response body', async () => {
      checkDatabaseHealth.mockRejectedValue(new Error(LEAKY_DRIVER_ERROR));
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const error = expectHttpException(await controller.readiness().catch((c: unknown) => c));
      const body = error.getResponse();

      expect(body).toEqual({ status: 'error' });
      expect(JSON.stringify(body)).not.toContain('postgres-internal.vps.example');
      expect(JSON.stringify(body)).not.toContain('family_platform_staging');
    });

    it('records the underlying failure server-side so it is still diagnosable', async () => {
      checkDatabaseHealth.mockRejectedValue(new Error(LEAKY_DRIVER_ERROR));
      const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await controller.readiness().catch(() => undefined);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]?.[0]).toContain('postgres-internal.vps.example');
    });
  });
});
