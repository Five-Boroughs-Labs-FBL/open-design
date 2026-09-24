import type { ChildProcess } from 'node:child_process';

export const DEFAULT_AGENT_PROCESS_CONCURRENCY = 4;
export const DEFAULT_AGENT_PROCESS_QUEUE_LIMIT = 16;

export class AgentProcessQueueFullError extends Error {
  readonly code = 'AGENT_PROCESS_QUEUE_FULL';

  constructor() {
    super('The agent process queue is full. Retry this run shortly.');
    this.name = 'AgentProcessQueueFullError';
  }
}

export class AgentProcessAdmissionAbortedError extends Error {
  readonly code = 'AGENT_PROCESS_ADMISSION_ABORTED';

  constructor() {
    super('The queued agent process was canceled.');
    this.name = 'AgentProcessAdmissionAbortedError';
  }
}

export interface AgentProcessAdmission {
  acquire(options?: { signal?: AbortSignal }): Promise<() => void>;
  snapshot(): {
    active: number;
    queued: number;
    maxActive: number;
    maxQueued: number;
  };
}

interface AdmissionWaiter {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
}

export function createAgentProcessAdmission(options: {
  maxActive?: number;
  maxQueued?: number;
} = {}): AgentProcessAdmission {
  const maxActive = positiveInteger(options.maxActive, DEFAULT_AGENT_PROCESS_CONCURRENCY);
  const maxQueued = nonNegativeInteger(options.maxQueued, DEFAULT_AGENT_PROCESS_QUEUE_LIMIT);
  let active = 0;
  const waiters: AdmissionWaiter[] = [];

  const createRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      dispatch();
    };
  };

  const dispatch = (): void => {
    while (active < maxActive && waiters.length > 0) {
      const waiter = waiters.shift()!;
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(new AgentProcessAdmissionAbortedError());
        continue;
      }
      active += 1;
      waiter.resolve(createRelease());
    }
  };

  return {
    acquire({ signal } = {}) {
      if (signal?.aborted) {
        return Promise.reject(new AgentProcessAdmissionAbortedError());
      }
      if (active < maxActive && waiters.length === 0) {
        active += 1;
        return Promise.resolve(createRelease());
      }
      if (waiters.length >= maxQueued) {
        return Promise.reject(new AgentProcessQueueFullError());
      }
      return new Promise((resolve, reject) => {
        const waiter: AdmissionWaiter = {
          ...(signal ? { signal } : {}),
          resolve,
          reject,
        };
        if (signal) {
          waiter.onAbort = () => {
            const index = waiters.indexOf(waiter);
            if (index < 0) return;
            waiters.splice(index, 1);
            signal.removeEventListener('abort', waiter.onAbort!);
            reject(new AgentProcessAdmissionAbortedError());
            dispatch();
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        waiters.push(waiter);
      });
    },
    snapshot() {
      return { active, queued: waiters.length, maxActive, maxQueued };
    },
  };
}

export function createAgentProcessAdmissionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AgentProcessAdmission {
  return createAgentProcessAdmission({
    maxActive: parseEnvInteger(env.OD_AGENT_PROCESS_MAX_ACTIVE, DEFAULT_AGENT_PROCESS_CONCURRENCY, 1),
    maxQueued: parseEnvInteger(env.OD_AGENT_PROCESS_MAX_QUEUED, DEFAULT_AGENT_PROCESS_QUEUE_LIMIT, 0),
  });
}

export function releaseAgentProcessAdmissionOnChildExit(
  child: Pick<ChildProcess, 'pid' | 'once'>,
  release: () => void,
): void {
  child.once('close', release);
  child.once('error', () => {
    if (typeof child.pid !== 'number') release();
  });
}

export function spawnWithAgentProcessAdmission<T>(
  release: () => void,
  spawn: () => T,
): T {
  try {
    return spawn();
  } catch (error) {
    release();
    throw error;
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function parseEnvInteger(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}
