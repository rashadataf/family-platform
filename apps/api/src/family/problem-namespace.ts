import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

/**
 * Which context's problem types these two guards answer with. Spec 009 reuses
 * both guards unchanged in what they DECIDE — Calendar adds no guard — but its
 * contract promises `calendar/not_found` and `calendar/capability_required`,
 * so a controller names its namespace once at class level and the guards
 * speak it. Absent, they speak `family`, exactly as before.
 *
 * Spec 010 adds `task` — singular, because the namespace is interpolated
 * straight into the type (`task/not_found`) and that is what its contract
 * declares.
 */
export const PROBLEM_NAMESPACE = 'family:problemNamespace';
export type ProblemNamespace = 'family' | 'calendar' | 'task';

export const UsesProblemNamespace = (namespace: ProblemNamespace) =>
  SetMetadata(PROBLEM_NAMESPACE, namespace);

export function problemNamespaceOf(
  reflector: Reflector,
  context: ExecutionContext,
): ProblemNamespace {
  return (
    reflector.getAllAndOverride<ProblemNamespace | undefined>(PROBLEM_NAMESPACE, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'family'
  );
}
