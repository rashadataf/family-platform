# Working agreement

## Implementation runs one task at a time

When implementing a spec (`/speckit-implement`, or any request to "continue the
implementation"), work through `specs/<feature>/tasks.md` **one task at a time**:

1. Read `tasks.md` and pick the **first unticked task**. That is where work resumes —
   there is no other bookmark, so the ticks must always be truthful.
2. Implement **that task only**. Do not start the next one, and do not opportunistically
   fix things the task does not cover.
3. Verify it — at minimum the tests the task names, plus `typecheck` and `lint` for the
   packages touched.
4. Tick it: `- [ ] T0NN` becomes `- [X] T0NN`, in the same commit as the work.
5. Report what was done in a couple of lines, then **stop and hand back**.

Do not batch tasks, and do not run a phase end-to-end in one session, even when the tasks
look small or related. The reason is cost, not caution: a session that rolls through many
tasks accumulates a very large context, and the usage limit is reached long before the
feature is. Short sessions with truthful ticks are resumable; a long one is not.

Exception: the user may explicitly ask for several tasks, or a whole phase, in one go.
Then do exactly the scope they named and stop there.

## Ticking rules

- A task is ticked only when its work is **done and verified**, not when it is written.
- Never tick a task speculatively, and never tick one whose verification was skipped.
- If the code on disk already satisfies a task, verify that claim before ticking it, and
  say in the report that it was pre-existing rather than newly written.
- Leave a task unticked if any part of it is outstanding, and say which part.

## Commits

- Commit the completed task's work together with its tick in `tasks.md`.
- Never append `Co-Authored-By: Claude` trailers.
