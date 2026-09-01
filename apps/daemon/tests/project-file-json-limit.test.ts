import express from 'express';
import { describe, expect, it } from 'vitest';

function jsonParser(limit: string) {
  const parser = express.json({ limit });
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    parser(req, res, (err?: unknown) => {
      const error = err as { type?: string; status?: number; statusCode?: number } | undefined;
      if (error && (error.type === 'entity.too.large' || error.status === 413 || error.statusCode === 413)) {
        return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body too large' } });
      }
      return next(err);
    });
  };
}

describe('project file JSON limit is route-specific', () => {
  it('accepts a 5mb JSON body on POST /api/projects/:id/files and still 413s other JSON at 4mb', async () => {
    const app = express();
    app.use('/api/projects/:id/files', jsonParser('32mb'));
    app.use(jsonParser('4mb'));
    app.post('/api/projects/:id/files', (req, res) => {
      res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body)) });
    });
    app.post('/api/other', (req, res) => {
      res.json({ ok: true });
    });
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as { port: number }).port;
    const fat = 'x'.repeat(5 * 1024 * 1024);
    try {
      const filesRes = await fetch(`http://127.0.0.1:${port}/api/projects/p1/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'index.html', content: fat }),
      });
      expect(filesRes.status).toBe(200);

      const otherRes = await fetch(`http://127.0.0.1:${port}/api/other`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: fat }),
      });
      expect(otherRes.status).toBe(413);
      const body = await otherRes.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
