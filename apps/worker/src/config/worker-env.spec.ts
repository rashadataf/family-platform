import { describe, expect, it } from 'vitest';
import { cadenceVariableFor, SWEEPS } from '../sweeps/registry.js';
import { DEFAULT_HEARTBEAT_PATH, parseWorkerEnv, WORKER_ENV_VARIABLES } from './worker-env.js';

/** An environment with nothing in it, so every default is exercised. */
const EMPTY: NodeJS.ProcessEnv = {};

describe('parseWorkerEnv (Phase 8, Principle II)', () => {
  it('defaults every sweep to the cadence research.md §6 fixes', () => {
    const env = parseWorkerEnv(EMPTY);
    expect(Object.keys(env.cadences).sort()).toEqual(SWEEPS.map((s) => s.name).sort());

    expect(env.cadences['report-overdue-tasks']).toBe(60);
    expect(env.cadences['materialise-occurrences']).toBe(3_600);
    expect(env.cadences['erase-unverified']).toBe(3_600);
    expect(env.cadences['erase-deleted-accounts']).toBe(3_600);
    expect(env.cadences['erase-stale-sessions']).toBe(3_600);
    expect(env.cadences['expire-invitations']).toBe(3_600);
    expect(env.cadences['guardian-coverage']).toBe(86_400);
  });

  it('gives every registered sweep a default, with no gaps', () => {
    const env = parseWorkerEnv(EMPTY);
    for (const sweep of SWEEPS) {
      expect(env.cadences[sweep.name], sweep.name).toBe(sweep.defaultCadenceSeconds);
    }
  });

  it('reads an override for each sweep from its own variable', () => {
    for (const sweep of SWEEPS) {
      const env = parseWorkerEnv({ [cadenceVariableFor(sweep.name)]: '120' });
      expect(env.cadences[sweep.name], sweep.name).toBe(120);
      // The others are untouched.
      for (const other of SWEEPS.filter((s) => s.name !== sweep.name)) {
        expect(env.cadences[other.name], other.name).toBe(other.defaultCadenceSeconds);
      }
    }
  });

  it('names the variable in kebab-to-screaming-snake form', () => {
    expect(cadenceVariableFor('report-overdue-tasks')).toBe(
      'SWEEP_REPORT_OVERDUE_TASKS_INTERVAL_SECONDS',
    );
    expect(cadenceVariableFor('guardian-coverage')).toBe(
      'SWEEP_GUARDIAN_COVERAGE_INTERVAL_SECONDS',
    );
  });

  describe('a cadence that is present but invalid fails the boot, naming the variable', () => {
    const variable = cadenceVariableFor('report-overdue-tasks');

    it('refuses 0', () => {
      expect(() => parseWorkerEnv({ [variable]: '0' })).toThrow(variable);
      expect(() => parseWorkerEnv({ [variable]: '0' })).toThrow(/greater than zero/);
    });

    it('refuses a negative value', () => {
      expect(() => parseWorkerEnv({ [variable]: '-30' })).toThrow(variable);
    });

    it('refuses a non-numeric value', () => {
      expect(() => parseWorkerEnv({ [variable]: 'often' })).toThrow(variable);
      expect(() => parseWorkerEnv({ [variable]: 'often' })).toThrow(/whole number of seconds/);
    });

    it('refuses a fractional value', () => {
      expect(() => parseWorkerEnv({ [variable]: '1.5' })).toThrow(variable);
    });

    it('reports every bad variable at once, not just the first', () => {
      const first = cadenceVariableFor('report-overdue-tasks');
      const second = cadenceVariableFor('guardian-coverage');
      let message = '';
      try {
        parseWorkerEnv({ [first]: 'nope', [second]: '-1' });
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).toContain(first);
      expect(message).toContain(second);
    });
  });

  it('treats an absent or blank cadence as "use the default", not as an error', () => {
    const variable = cadenceVariableFor('report-overdue-tasks');
    expect(parseWorkerEnv({}).cadences['report-overdue-tasks']).toBe(60);
    expect(parseWorkerEnv({ [variable]: '' }).cadences['report-overdue-tasks']).toBe(60);
    expect(parseWorkerEnv({ [variable]: '   ' }).cadences['report-overdue-tasks']).toBe(60);
  });

  describe('WORKER_HEARTBEAT_PATH', () => {
    it('defaults sensibly', () => {
      expect(parseWorkerEnv(EMPTY).heartbeatPath).toBe(DEFAULT_HEARTBEAT_PATH);
      expect(DEFAULT_HEARTBEAT_PATH.startsWith('/')).toBe(true);
    });

    it('is taken as given when set', () => {
      expect(parseWorkerEnv({ WORKER_HEARTBEAT_PATH: '/var/run/fp' }).heartbeatPath).toBe(
        '/var/run/fp',
      );
    });

    it('falls back to the default when blank', () => {
      expect(parseWorkerEnv({ WORKER_HEARTBEAT_PATH: '  ' }).heartbeatPath).toBe(
        DEFAULT_HEARTBEAT_PATH,
      );
    });
  });

  it('declares every variable it reads, for docs and verify:env', () => {
    expect(WORKER_ENV_VARIABLES).toContain('WORKER_HEARTBEAT_PATH');
    for (const sweep of SWEEPS) {
      expect(WORKER_ENV_VARIABLES).toContain(cadenceVariableFor(sweep.name));
    }
    expect(WORKER_ENV_VARIABLES).toHaveLength(SWEEPS.length + 1);
  });

  it('ignores unrelated variables entirely', () => {
    const env = parseWorkerEnv({ DATABASE_URL: 'postgres://nope', NODE_ENV: 'production' });
    expect(env.cadences['report-overdue-tasks']).toBe(60);
    expect(env.heartbeatPath).toBe(DEFAULT_HEARTBEAT_PATH);
  });
});
