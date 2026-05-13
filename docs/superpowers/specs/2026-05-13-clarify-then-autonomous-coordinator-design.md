# Clarify-Then-Autonomous Coordinator Design

Date: 2026-05-13
Status: Approved by user

## Goal

The project should support a single-window workflow where the user describes a requirement once, the coordinator clarifies the requirement up front, and then the coordinator runs the downstream agent pipeline without asking the user to manually advance each stage.

The desired operating model is "clarify first, then autonomous": Stage 0 remains interactive because unclear requirements must not be delegated, but once Stage 0 is complete the coordinator owns stage transitions, subagent dispatch, artifact checks, and status reporting.

## Chosen Approach

Use the existing `CLARIFIED.md` boundary as the automation gate.

Before `CLARIFIED.md` exists, the coordinator may ask questions, inspect disk state, and summarize its understanding. After the user confirms the Stage 0 summary, the coordinator writes `CLARIFIED.md` and automatically runs:

1. Move task from `tasks/backlog/` to `tasks/in-progress/`.
2. Dispatch `spec-writer` to produce `SPEC.md`.
3. If `SPEC.md` is produced, dispatch `coder` to implement it and produce `IMPL-NOTES.md`.
4. If implementation status is `OK` or `PARTIAL`, dispatch `reviewer` to produce `REVIEW.md`.
5. Report the final state to the user with artifact paths and the required human action, usually manual verification and commit.

## Human Checkpoints

There is one normal checkpoint:

- At the end of Stage 0, the coordinator summarizes the clarified requirement and asks for confirmation before writing `CLARIFIED.md` and starting the autonomous pipeline.

The coordinator must stop and ask the user only for exceptional checkpoints:

- A subagent returns `STOP`.
- The reviewer returns `BLOCK`.
- The task involves non-delegable decisions such as auth, RBAC, secrets, irreversible DB migration, external API contracts, cache or index design, or architecture trade-offs that were not already settled.
- Disk state contradicts the user's described current state.
- A task grows beyond the allowed size and must be split.

## Components

- Coordinator: owns Stage 0, task creation, stage transitions, subagent dispatch, artifact verification, and user reporting. It does not write implementation code.
- `spec-writer`: converts `CLARIFIED.md` into `SPEC.md` or returns `STOP.md`.
- `coder`: implements `SPEC.md` in the target working tree and writes `IMPL-NOTES.md`. It does not commit.
- `reviewer`: checks implementation against `SPEC.md`, reruns automatic acceptance where possible, and writes `REVIEW.md`.
- Task artifacts: the persistent source of truth for cross-session resume.

## Data Flow

1. User requirement enters the coordinator.
2. Coordinator spot-checks disk where the requirement depends on current state.
3. Coordinator asks only the questions needed to remove ambiguity.
4. Coordinator asks the user to confirm the clarified summary.
5. Coordinator creates `tasks/backlog/T-XXXX-<slug>/CLARIFIED.md`.
6. Coordinator moves the task to `tasks/in-progress/`.
7. Stage artifacts accumulate in the same task directory: `SPEC.md`, `IMPL-NOTES.md`, and `REVIEW.md`.
8. Coordinator reads artifacts, not subagent claims, to decide the next stage.
9. Coordinator reports the final state and waits for human verification or commit where required.

## Error Handling

- `spec-writer` returns `STOP.md`: return to Stage 0 and ask the specific unresolved questions.
- `coder` returns `IMPL-NOTES.md` with `STOP`: inspect the reason and route either back to Stage 0, back to Stage 1, or to the user for an exceptional checkpoint.
- `coder` returns `PARTIAL`: continue to reviewer if review is still meaningful, then report remaining manual checks.
- `reviewer` returns `REQUEST_CHANGES`: dispatch `coder` again with `REVIEW.md` as additional read-only input.
- `reviewer` returns `BLOCK`: stop and ask the user whether to open a follow-up task, abandon the task, or revise the requirement.
- Artifact missing or malformed: stop, report the broken stage, and do not infer success from subagent response text.

## Resume Rules

On every new session, the coordinator must inspect `tasks/backlog/`, `tasks/in-progress/`, and `tasks/done/`, then infer actual stage from artifacts on disk.

The coordinator should resume the next deterministic stage automatically when no exceptional checkpoint is present. For example:

- `CLARIFIED.md` only: dispatch `spec-writer`.
- `CLARIFIED.md` plus `SPEC.md`: dispatch `coder`.
- `CLARIFIED.md`, `SPEC.md`, and `IMPL-NOTES.md`: dispatch `reviewer` unless implementation status is `STOP`.
- All four artifacts: report verdict and next action.

## Testing Strategy

This workflow should be validated with dogfood tasks before broad use:

- A normal small task that reaches `APPROVE`.
- A task where `spec-writer` returns `STOP`.
- A task where `coder` returns `REQUEST_CHANGES` after review.
- A task where reviewer returns `BLOCK` and the coordinator opens or proposes a follow-up task.
- A cross-session resume where the coordinator restarts from disk artifacts and continues the correct next stage.

## Non-Goals

- No visual kanban UI in this design.
- No automatic commit or push.
- No bypass of Stage 0 for ambiguous requirements.
- No coordinator implementation-code edits.
- No replacement of the existing `spec-writer`, `coder`, or `reviewer` role boundaries.
