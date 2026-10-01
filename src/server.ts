import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from './config.js';
import { DomainError } from './errors.js';
import { DEFAULT_LIMIT, factorPolynomial } from './factor.js';
import { assertSupportedPrime, canonicalFromText } from './finiteField.js';
import { buildReport, FactorizationReport, reportHash, verifyReport } from './report.js';
import { ReportStore } from './store.js';

type Json = Record<string, unknown>;
const config = loadConfig();
const store = new ReportStore(config.dbPath);

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text) as Json;
}
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}
function makeReport(body: Json): FactorizationReport {
  const p = assertSupportedPrime(String(body.prime));
  if (!Array.isArray(body.coefficients)) throw new DomainError('INVALID_INPUT', 'coefficients 必须是字符串数组');
  const poly = canonicalFromText(body.coefficients.map(String), p);
  const budget = body.budgetLimit ? BigInt(String(body.budgetLimit)) : DEFAULT_LIMIT;
  if (budget < 1n || budget > 10_000_000n) throw new DomainError('BUDGET_EXCEEDED', 'budgetLimit 必须在 1 到 10000000 之间');
  const factorization = factorPolynomial(poly, p, budget);
  const report = buildReport(String(p), body.coefficients.map(String), factorization, budget);
  store.save(report);
  store.logVerification(report.id, true, verifyReport(store.get(report.id)));
  return report;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'finite-field-poly-factor', port: config.port, dbPath: config.dbPath });
    if (req.method === 'POST' && url.pathname === '/api/factor') {
      const report = makeReport(await readJson(req));
      return send(res, 200, { report, sha256: reportHash(report), verification: verifyReport(report) });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') {
      const body = await readJson(req);
      const result = verifyReport(body.report ?? body);
      const id = (body.report as FactorizationReport | undefined)?.id ?? (body as FactorizationReport).id ?? null;
      store.logVerification(id, result.valid, result);
      return send(res, result.valid ? 200 : 400, result);
    }
    if (req.method === 'GET' && url.pathname === '/api/reports') return send(res, 200, { reports: store.list() });
    const match = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]+)\/?(export|tamper-demo)?$/);
    if (req.method === 'GET' && match) {
      const report = store.get(match[1]);
      if (!report) return send(res, 404, { error: 'REPORT_NOT_FOUND', message: '旧报告不存在' });
      if (match[2] === 'export') return send(res, 200, report);
      if (match[2] === 'tamper-demo') {
        const tampered: FactorizationReport = JSON.parse(JSON.stringify(report));
        if (tampered.factors[0]) tampered.factors[0].factor = ['0', '1', '1'];
        return send(res, 200, { originalHash: reportHash(report), tamperedReport: tampered, tamperedHash: reportHash(tampered), verification: verifyReport(tampered) });
      }
      return send(res, 200, { report, sha256: reportHash(report), verification: verifyReport(report) });
    }
    return send(res, 404, { error: 'NOT_FOUND', message: '未知 API 路径' });
  } catch (error) {
    const status = error instanceof DomainError ? 400 : error instanceof SyntaxError ? 400 : 500;
    return send(res, status, { error: error instanceof DomainError ? error.code : 'INTERNAL_ERROR', message: (error as Error).message });
  }
});

server.listen(config.port, () => {
  console.log(`有限域多项式分解服务已启动: http://127.0.0.1:${config.port}`);
  console.log(`SQLite 数据文件: ${config.dbPath}`);
});
