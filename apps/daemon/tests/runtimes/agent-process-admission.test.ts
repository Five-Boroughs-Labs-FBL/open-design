import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  AgentProcessAdmissionAbortedError,
  AgentProcessQueueFullError,
  createAgentProcessAdmission,
  createAgentProcessAdmissionFromEnv,
  releaseAgentProcessAdmissionOnChildExit,
  spawnWithAgentProcessAdmission,
} from '../../src/runtimes/agent-process-admission.js';

describe('agent process admission', () => {
  it('limits active children and admits waiters in FIFO order', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 3 });
    const releaseFirst = await admission.acquire();
    const order: number[] = [];
    const second = admission.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const third = admission.acquire().then((release) => {
      order.push(3);
      return release;
    });

    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 2 });
    releaseFirst();
    const releaseSecond = await second;
    expect(order).toEqual([2]);
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 1 });
    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual([2, 3]);
    releaseThird();
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('aborts a queued waiter and frees its bounded queue position', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 1 });
    const releaseActive = await admission.acquire();
    const controller = new AbortController();
    const canceled = admission.acquire({ signal: controller.signal });

    controller.abort();
    await expect(canceled).rejects.toBeInstanceOf(AgentProcessAdmissionAbortedError);
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 0 });

    const next = admission.acquire();
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 1 });
    releaseActive();
    const releaseNext = await next;
    releaseNext();
  });

  it('rejects admission when both active capacity and the finite queue are full', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 1 });
    const releaseActive = await admission.acquire();
    const queued = admission.acquire();

    await expect(admission.acquire()).rejects.toBeInstanceOf(AgentProcessQueueFullError);
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 1 });
    releaseActive();
    const releaseQueued = await queued;
    releaseQueued();
  });

  it('releases a permit when process creation throws', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 0 });
    const release = await admission.acquire();

    expect(() => spawnWithAgentProcessAdmission(release, () => {
      throw new Error('spawn failed');
    })).toThrow('spawn failed');

    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0 });
    const releaseNext = await admission.acquire();
    releaseNext();
  });

  it('holds an active permit through cancellation until child close', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 1 });
    const releaseActive = await admission.acquire();
    const child = new EventEmitter() as EventEmitter & { pid: number };
    child.pid = 42;
    releaseAgentProcessAdmissionOnChildExit(child as never, releaseActive);
    const next = admission.acquire();

    const cancelSignalError = new Error('cancel signal delivered');
    child.emit('error', cancelSignalError);
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 1 });

    child.emit('close', null, 'SIGTERM');
    const releaseNext = await next;
    expect(admission.snapshot()).toMatchObject({ active: 1, queued: 0 });
    releaseNext();
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('releases an admission lease only once when child close is repeated', async () => {
    const admission = createAgentProcessAdmission({ maxActive: 1, maxQueued: 0 });
    const release = await admission.acquire();
    const child = new EventEmitter() as EventEmitter & { pid: number };
    child.pid = 42;
    releaseAgentProcessAdmissionOnChildExit(child as never, release);

    child.emit('close', 0, null);
    child.emit('close', 0, null);
    expect(admission.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('uses configurable environment limits and safe defaults for invalid values', () => {
    expect(createAgentProcessAdmissionFromEnv({
      OD_AGENT_PROCESS_MAX_ACTIVE: '2',
      OD_AGENT_PROCESS_MAX_QUEUED: '5',
    }).snapshot()).toMatchObject({ maxActive: 2, maxQueued: 5 });
    expect(createAgentProcessAdmissionFromEnv({
      OD_AGENT_PROCESS_MAX_ACTIVE: '0',
      OD_AGENT_PROCESS_MAX_QUEUED: '-1',
    }).snapshot()).toMatchObject({ maxActive: 4, maxQueued: 16 });
  });
});
