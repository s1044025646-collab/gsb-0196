import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { DomainError } from '../core/errors';
import { Store } from '../store/database';
import { buildAndStoreReport, getReport, verifyStored } from '../service/factorService';
import { verifyReport } from '../core/verify';
import { FactorizationReport } from '../store/schema';

interface RouteResult {
  status: number;
  body: unknown;
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

export function createApp(store: Store) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, service: 'gf-poly-factor' });
      }

      if (req.method === 'POST' && path === '/api/polynomials/factor') {
        const body = await readJson(req);
        const out = buildAndStoreReport(store, { p: Number(body.p), coeffs: body.coeffs });
        const status = out.kind === 'POLYNOMIAL' ? 200 : 422;
        return send(res, status, out);
      }

      if (req.method === 'GET' && path.startsWith('/api/reports/') && path.endsWith('/verify')) {
        const id = path.split('/')[3];
        return send(res, 200, { report_id: id, verification: verifyStored(store, id) });
      }

      if (req.method === 'GET' && path.startsWith('/api/reports/')) {
        const id = path.split('/')[3];
        return send(res, 200, getReport(store, id));
      }

      if (req.method === 'GET' && path === '/api/reports') {
        return send(res, 200, { reports: store.listReports() });
      }

      // 直接核验调用方提供的报告（用于篡改演示，不依赖数据库）。
      if (req.method === 'POST' && path === '/api/verify') {
        const body = (await readJson(req)) as { report: FactorizationReport };
        return send(res, 200, { verification: verifyReport(body.report) });
      }

      return send(res, 404, { error: 'NOT_FOUND', message: `无此路由: ${path}` });
    } catch (e) {
      if (e instanceof DomainError) {
        const status = e.code === 'NOT_FOUND' ? 404 : 400;
        return send(res, status, { error: e.code, message: e.message });
      }
      return send(res, 500, { error: 'INTERNAL', message: (e as Error).message });
    }
  });
}

export function startServer(store: Store, port: number) {
  const server = createApp(store);
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
