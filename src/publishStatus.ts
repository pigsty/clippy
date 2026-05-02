import fs from 'fs';
import path from 'path';
import { CONTENT_DIR } from './videos';

export type PublishState = 'idle' | 'running' | 'success' | 'failed';

export interface PublishStatus {
  state: PublishState;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const STATUS_PATH = path.join(CONTENT_DIR, 'publish-status.json');

const DEFAULT_STATUS: PublishStatus = {
  state: 'idle',
};

export function getPublishStatus(): PublishStatus {
  if (!fs.existsSync(STATUS_PATH)) {
    return DEFAULT_STATUS;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')) as PublishStatus;
    if (!parsed || (parsed.state !== 'idle' && parsed.state !== 'running' && parsed.state !== 'success' && parsed.state !== 'failed')) {
      return DEFAULT_STATUS;
    }

    return parsed;
  } catch {
    return DEFAULT_STATUS;
  }
}

export function setPublishStatus(status: PublishStatus): void {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), 'utf-8');
}

export function markPublishRunning(): void {
  setPublishStatus({
    state: 'running',
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    error: undefined,
  });
}

export function markPublishSuccess(): void {
  const current = getPublishStatus();
  setPublishStatus({
    state: 'success',
    startedAt: current.startedAt,
    completedAt: new Date().toISOString(),
    error: undefined,
  });
}

export function markPublishFailed(error: string): void {
  const current = getPublishStatus();
  setPublishStatus({
    state: 'failed',
    startedAt: current.startedAt,
    completedAt: new Date().toISOString(),
    error,
  });
}
