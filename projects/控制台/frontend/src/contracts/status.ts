import {
  BULLETIN_STATUSES,
  RUNNER_STATUSES,
  TASK_NODE_STATUSES,
  TASK_PROGRESS_STATES,
  TASK_STATUSES,
  type BulletinStatus,
  type RunnerStatus,
  type TaskNodeStatus,
  type TaskProgressState,
  type TaskStatus,
} from '../types.js';
import { readEnum } from './runtime.js';

export function readTaskStatus(value: unknown, path: string): TaskStatus {
  return readEnum(value, TASK_STATUSES, path);
}

export function readTaskNodeStatus(value: unknown, path: string): TaskNodeStatus {
  return readEnum(value, TASK_NODE_STATUSES, path);
}

export function readRunnerStatus(value: unknown, path: string): RunnerStatus {
  return readEnum(value, RUNNER_STATUSES, path);
}

export function readBulletinStatus(value: unknown, path: string): BulletinStatus {
  return readEnum(value, BULLETIN_STATUSES, path);
}

export function readTaskProgressState(value: unknown, path: string): TaskProgressState {
  return readEnum(value, TASK_PROGRESS_STATES, path);
}
