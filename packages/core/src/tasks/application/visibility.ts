import type { FamilyId, FamilyMemberId, TaskId, UserId } from '@fp/kernel';
import type { AuditLogPort } from '../../compliance/application/ports/audit-log.port.js';
import type {
  MemberVisibility,
  MemberVisibilityPort,
} from '../../family/application/ports/member-visibility.port.js';

/**
 * FR-014 and FR-015, shared by every Tasks read and every write addressing an
 * existing task. One implementation, so a later route cannot apply a slightly
 * different rule.
 *
 * Modelled on Calendar's `visibility.ts` and deliberately NOT imported from it
 * (research.md §1): Tasks may not depend on Calendar (FR-012), and the RULE is
 * not duplicated — it lives behind `MemberVisibilityPort`. What is here is
 * set membership over the port's answer, and an audit row with Tasks' own
 * action name.
 */

export interface Reader {
  readonly familyId: FamilyId;
  readonly memberId: FamilyMemberId;
  readonly userId: UserId | null;
  readonly correlationId: string;
}

export interface ResolvedVisibility {
  readonly visible: ReadonlySet<FamilyMemberId>;
  readonly guardedChildren: ReadonlySet<FamilyMemberId>;
  readonly visibleMemberIds: readonly FamilyMemberId[];
}

/** Asked before Tasks opens its own transaction: the port's adapter cannot join one it was not given. */
export async function resolveVisibility(
  port: MemberVisibilityPort,
  reader: Reader,
): Promise<ResolvedVisibility> {
  const result: MemberVisibility = await port.resolveVisibleMemberIds(
    reader.memberId,
    reader.familyId,
  );
  return {
    visible: new Set(result.visibleMemberIds),
    guardedChildren: new Set(result.guardedChildIds),
    visibleMemberIds: result.visibleMemberIds,
  };
}

/**
 * The assignees that put a task out of this reader's reach. Hidden if ANY
 * assignee is outside the visible set — showing it would disclose the unguarded
 * child's chore. No assignees at all: visible to every reader.
 */
export function hiddenAssignees(
  assignees: readonly FamilyMemberId[],
  visibility: ResolvedVisibility,
): FamilyMemberId[] {
  return assignees.filter((member) => !visibility.visible.has(member));
}

/** The assignees a permitted read reaches that are children — the rows FR-015 audits. */
export function guardedChildAssignees(
  assignees: readonly FamilyMemberId[],
  visibility: ResolvedVisibility,
): FamilyMemberId[] {
  return assignees.filter((member) => visibility.guardedChildren.has(member));
}

/**
 * One audit row per (task, child). The subject is the CHILD; the task is named
 * in `purpose` by identifier only — never by title (SC-011).
 */
export async function auditChildAssignment(
  audit: AuditLogPort,
  params: {
    reader: Reader;
    taskId: TaskId;
    childMemberIds: readonly FamilyMemberId[];
    view: 'task detail' | 'task list' | 'task history' | 'task change';
    result: 'granted' | 'denied';
  },
): Promise<void> {
  for (const childMemberId of params.childMemberIds) {
    await audit.append({
      actorUserId: params.reader.userId,
      actorMemberId: params.reader.memberId,
      familyId: params.reader.familyId,
      subjectType: 'family_member',
      subjectId: childMemberId,
      action: 'task_assignment.read',
      purpose: `${params.view} of task ${params.taskId}`,
      result: params.result,
      // The real reason, which the caller is not told: on the wire a hidden task
      // is indistinguishable from a missing one (FR-014, SC-004).
      reason:
        params.result === 'granted'
          ? null
          : 'task has a child assignee the reader holds no active guardianship for (FR-014)',
      correlationId: params.reader.correlationId,
    });
  }
}
