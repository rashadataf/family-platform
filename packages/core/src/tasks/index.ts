// Tasks bounded context (spec 010, ARCHITECTURE.md §5.4).
//
// The second context built on the tenant root, and the first to consume a
// shared kernel it did not write. It learns a caller's standing only through
// Family's `FamilyContextPort` (applied by the API's guards) and who a reader
// may see only through `MemberVisibilityPort`. It depends on Calendar not at
// all (FR-012). `reads-family-only-through-published-ports.spec.ts` holds it to
// both.

export {
  Task,
  NOTES_MAX,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TITLE_MAX,
  type ChangedFieldGroup,
  type TaskCategory,
  type TaskCommand,
  type TaskPatch,
  type TaskPriority,
  type TaskProps,
  type TaskState,
  type TaskStatus,
} from './domain/task.aggregate.js';
export {
  dueLocalDateTime,
  dueMomentOf,
  formatLocalTime,
  parseDue,
  parseLocalTime,
  type Due,
  type DueInput,
  type DueKind,
  type LocalTime,
} from './domain/due.js';
export { successorDueOf } from './domain/successor.js';
export { isOverdue, needsOverdueReport } from './domain/overdue.js';
export { type TaskAssignment } from './domain/task-assignment.js';
export {
  TASK_EVENT_TYPES,
  taskAssignedEvent,
  taskCancelledEvent,
  taskCompletedEvent,
  taskCreatedEvent,
  taskOverdueEvent,
  taskUpdatedEvent,
} from './domain/events.js';

export {
  type TasksUnitOfWork,
  type TasksUnitOfWorkPort,
} from './application/ports/tasks-unit-of-work.port.js';
export {
  SeriesInvariantViolatedError,
  type ClosedCursor,
  type ClosedListQuery,
  type OpenCursor,
  type OpenListQuery,
  type TaskRepository,
} from './application/ports/task.repository.js';
export {
  AssigneeNotInFamilyError,
  type TaskAssignmentRepository,
} from './application/ports/task-assignment.repository.js';
export { type TasksReadPort } from './application/ports/tasks-read.port.js';
export { type ErasurePort } from './application/ports/erasure.port.js';
export { type Reader } from './application/visibility.js';

export { createTask, type CreateTaskInput } from './application/commands/create-task.command.js';
export { updateTask } from './application/commands/update-task.command.js';
export {
  cancelTask,
  completeTask,
  reopenTask,
  type CloseTaskOutcome,
} from './application/commands/close-task.command.js';
export { assignTask, unassignTask } from './application/commands/assign-task.command.js';
export {
  reportOverdue,
  type ReportOverdueOutcome,
} from './application/commands/report-overdue.command.js';
export { getTask } from './application/queries/get-task.query.js';
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_RANGE_DAYS,
  listOpenTasks,
  listTaskHistory,
  type TaskPage,
} from './application/queries/list-tasks.query.js';
