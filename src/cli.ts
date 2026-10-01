#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { DomainError } from './errors.js';
import { DEFAULT_LIMIT, factorPolynomial } from './factor.js';
import { assertSupportedPrime, canonicalFromText } from './finiteField.js';
import { buildReport, reportHash, verifyReport } from './report.js';
import { ReportStore } from './store.js';

function usage(): string {
  return [
    '用法：',
    '  ffpoly factor <prime> <coeff-json> [budget]   分解并保存报告',
    '  ffpoly verify <report-json-file>             独立核验报告',
    '  ffpoly list                                  列出已保存报告',
    '  ffpoly export <id> [out.json]                导出报告',
    '  ffpoly tamper <id> [out.json]                构造篡改报告',
    '示例：npm run cli -- factor 2 "[1,1,1]"',
    '系数 JSON 数组元素为字符串或数字；所有大整数内部按字符串处理。'
  ].join('\n');
}
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const store = new ReportStore(config.dbPath);
  try {
    if (!command || command === 'help' || command === '--help') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (command === 'factor') {
      const [primeText, coeffText, budgetText] = args;
      if (!primeText || !coeffText) throw new DomainError('INVALID_INPUT', usage());
      const p = assertSupportedPrime(primeText);
      const input = JSON.parse(coeffText) as unknown[];
      if (!Array.isArray(input)) throw new DomainError('INVALID_INPUT', '系数必须是 JSON 数组');
      const budget = budgetText ? BigInt(budgetText) : DEFAULT_LIMIT;
      const report = buildReport(primeText, input.map(String), factorPolynomial(canonicalFromText(input.map(String), p), p, budget), budget);
      store.save(report);
      const verification = verifyReport(report);
      print({ report, sha256: reportHash(report), verification });
      if (!verification.valid) return 2;
      return 0;
    }
    if (command === 'verify') {
      const file = args[0];
      if (!file) throw new DomainError('INVALID_INPUT', usage());
      const report = JSON.parse(readLocal(file));
      const result = verifyReport(report);
      store.logVerification(report?.id ?? null, result.valid, result);
      print(result);
      return result.valid ? 0 : 2;
    }
    if (command === 'list') {
      print({ reports: store.list() });
      return 0;
    }
    if (command === 'export' || command === 'tamper') {
      const [id, out] = args;
      if (!id) throw new DomainError('INVALID_INPUT', usage());
      const report = store.get(id);
      if (!report) throw new DomainError('INVALID_INPUT', `未找到报告 ${id}`);
      let output = report;
      if (command === 'tamper') {
        if (!report.factors[0]) throw new DomainError('INVALID_INPUT', '该报告没有可篡改的非常数因子');
        report.factors[0].factor = ['0', '1', '1'];
        output = report;
      }
      const text = JSON.stringify(output, null, 2);
      if (out) writeFileSync(out, text, 'utf8');
      else process.stdout.write(`${text}\n`);
      if (command === 'tamper') print({ hash: reportHash(output as never), verification: verifyReport(output) });
      return command === 'tamper' ? 2 : 0;
    }
    throw new DomainError('INVALID_INPUT', usage());
  } catch (error) {
    print({ error: error instanceof DomainError ? error.code : 'INTERNAL_ERROR', message: (error as Error).message });
    return 1;
  } finally {
    store.close();
  }
}
function readLocal(file: string): string { return readFileSync(file, 'utf8'); }
main().then((code) => process.exit(code)).catch((error) => { console.error(error); process.exit(1); });
