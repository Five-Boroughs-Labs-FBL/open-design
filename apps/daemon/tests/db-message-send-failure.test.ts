import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, getMessage, insertConversation, insertProject, listMessages, openDatabase, upsertMessage } from '../src/db.js';

let tempDir: string | undefined;
afterEach(() => {
  closeDatabase();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('pre-run send failure persistence', () => {
  it('migrates an existing messages table without changing its rows', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-send-failure-migration-'));
    let db = openDatabase(tempDir, { dataDir: tempDir });
    insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'c', projectId: 'p', title: 'C', createdAt: 1, updatedAt: 1 });
    const message = { id: 'old-user', role: 'user', content: 'Existing conversation content' };
    upsertMessage(db, 'c', message);
    for (const column of ['send_failed', 'send_failure_detail', 'client_request_id']) {
      db.exec(`ALTER TABLE messages DROP COLUMN ${column}`);
    }
    closeDatabase();
    db = openDatabase(tempDir, { dataDir: tempDir });
    expect(getMessage(db, message.id)).toMatchObject({ content: message.content });
    upsertMessage(db, 'c', { ...message, sendFailed: true, sendFailureDetail: '503 unavailable', clientRequestId: 'old-request' });
    closeDatabase();
    db = openDatabase(tempDir, { dataDir: tempDir });
    expect(listMessages(db, 'c')).toHaveLength(1);
    expect(getMessage(db, message.id)).toMatchObject({ content: message.content, sendFailed: true, sendFailureDetail: '503 unavailable', clientRequestId: 'old-request' });
  });

  it('survives reopening the database and clears both fields on retry', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-send-failure-'));
    let db = openDatabase(tempDir, { dataDir: tempDir });
    insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'c', projectId: 'p', title: 'C', createdAt: 1, updatedAt: 1 });
    const message = { id: 'u', role: 'user', content: 'Edit this map', clientRequestId: 'logical-request' };
    upsertMessage(db, 'c', { ...message, sendFailed: true, sendFailureDetail: '503 unavailable Authorization: Bearer hidden-secret' });
    closeDatabase();
    db = openDatabase(tempDir, { dataDir: tempDir });
    expect(getMessage(db, 'u')).toMatchObject({ clientRequestId: 'logical-request', sendFailed: true, sendFailureDetail: '503 unavailable Authorization: [REDACTED] [REDACTED]' });
    expect(listMessages(db, 'c')[0]?.sendFailureDetail).not.toContain('hidden-secret');
    // Daemon run-create seeding carries no opinion about the web request id.
    upsertMessage(db, 'c', { id: message.id, role: message.role, content: message.content });
    expect(getMessage(db, 'u')?.clientRequestId).toBe('logical-request');
    upsertMessage(db, 'c', message);
    expect(getMessage(db, 'u')?.sendFailed).toBeUndefined();
    expect(getMessage(db, 'u')?.sendFailureDetail).toBeUndefined();
    upsertMessage(db, 'c', { ...message, sendFailed: true, sendFailureDetail: '409 conflict' });
    expect(getMessage(db, 'u')?.sendFailureDetail).toBe('409 conflict');
    upsertMessage(db, 'c', { ...message, id: 'a', role: 'assistant', sendFailed: true, sendFailureDetail: 'invalid' });
    expect(getMessage(db, 'a')?.sendFailed).toBeUndefined();
  });
});
