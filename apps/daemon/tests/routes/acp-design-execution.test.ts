import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase, getConversation, getMessage, getProject, insertConversation,
  insertProject, listConversations, listMessages, openDatabase, updateConversation,
  updateProject, upsertMessage,
} from '../../src/db.js';
import { registerProjectConversationRoutes, type RegisterProjectConversationRoutesDeps } from '../../src/routes/project/conversations.js';

describe('ACP Design conversation selection', () => {
  let db: ReturnType<typeof openDatabase>;
  let dir: string;
  let seedRun: Record<string, unknown> | null;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-design-selection-'));
    db = openDatabase(dir, { dataDir: dir });
    insertProject(db, { id: 'p', name: 'ACP', metadata: { amcFeatureRunId: 'frun-test' }, createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'c', projectId: 'p', createdAt: 1, updatedAt: 1 });
    upsertMessage(db, 'c', { id: 'seed', role: 'assistant', content: 'Design', agentId: 'muse', runId: 'seed-run', createdAt: 1 });
    upsertMessage(db, 'c', { id: 'leak', role: 'assistant', content: '', agentId: 'grok-build', runId: 'failed-grok', runStatus: 'failed', createdAt: 2 });
    seedRun = { id: 'seed-run', projectId: 'p', conversationId: 'c', agentId: 'muse', model: 'muse-spark-1.2-contributor', reasoning: 'high', amcCredential: { env: { META_API_KEY: 'must-not-leak' } } };
  });
  afterEach(() => {
    closeDatabase();
    // Only this test's freshly allocated directory is removed.
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function request(projectId = 'p', allowed = true) {
    const app = express();
    registerProjectConversationRoutes(app, {
      db, http: { sendApiError: () => undefined },
      paths: { BRANDS_DIR: dir, PROJECTS_DIR: dir, RUNTIME_DATA_DIR: dir },
      projectStore: { getProject, updateProject },
      conversations: { insertConversation, getConversation, listConversations, updateConversation, getMessage, listMessages, upsertMessage },
      ids: { randomId: () => 'unused' }, appConfig: { readAppConfig: async () => ({}) },
      agents: { getAgentDef: () => null }, design: { runs: { get: (id: string) => id === 'seed-run' ? seedRun : null } },
      authorizeProjectRequest: async (_req: unknown, res: express.Response) => {
        if (!allowed) res.status(403).json({ error: 'denied' });
        return allowed;
      },
    } as unknown as RegisterProjectConversationRoutesDeps);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${projectId}/conversations/c/acp-design-execution`);
      return { status: response.status, body: await response.json() };
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  it('returns Muse after the accidental failed Grok turn, without secrets', async () => {
    expect(await request()).toEqual({ status: 200, body: {
      agentId: 'muse', model: 'muse-spark-1.2-contributor', reasoning: 'high',
    } });
  });
  it('recovers a legacy model from the matching provider session after run eviction', async () => {
    seedRun = null;
    db.prepare('INSERT INTO agent_sessions (conversation_id, agent_id, session_id, model, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c', 'muse', 'session', 'muse-spark-1.2-contributor', 1);
    expect(await request()).toEqual({ status: 200, body: {
      agentId: 'muse', model: 'muse-spark-1.2-contributor', reasoning: null,
    } });
  });
  it('does not borrow a model from Grok when the Muse identity is missing', async () => {
    seedRun = null;
    db.prepare('INSERT INTO agent_sessions (conversation_id, agent_id, session_id, model, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('c', 'grok-build', 'session', 'grok-4.6', 1);
    expect((await request()).status).toBe(409);
  });
  it('rejects a run pointer from another project', async () => {
    seedRun = { ...seedRun, projectId: 'foreign' };
    expect((await request()).status).toBe(409);
  });
  it('enforces read authorization', async () => {
    expect((await request('p', false)).status).toBe(403);
  });
  it('does not resolve another project through its conversation id', async () => {
    expect((await request('foreign')).status).toBe(404);
  });
  it('does not impose ACP defaults on ordinary studio projects', async () => {
    updateProject(db, 'p', { metadata: { kind: 'other' } });
    expect((await request()).status).toBe(404);
  });
});
