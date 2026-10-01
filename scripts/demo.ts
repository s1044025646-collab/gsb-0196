import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_LIMIT, factorPolynomial } from '../src/factor.js';
import { canonicalFromText } from '../src/finiteField.js';
import { buildReport, reportHash, verifyReport } from '../src/report.js';
import { ReportStore } from '../src/store.js';

const dbPath = resolve('data', 'demo.db');
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
const store = new ReportStore(dbPath);

const examples: Array<[string, string[], string]> = [
  ['2', ['1', '1', '1'], 'F2 不可约二次'],
  ['2', ['1', '0', '1'], 'F2 导数为零：(x+1)^2'],
  ['3', ['1', '2', '2', '1'], 'F3 混合/多重因子'],
  ['13', ['1', '0', '0', '1'], 'F13 低次多项式']
];

for (const [primeText, input, title] of examples) {
  const p = BigInt(primeText);
  const poly = canonicalFromText(input, p);
  const factorization = factorPolynomial(poly, p, DEFAULT_LIMIT);
  const report = buildReport(primeText, input, factorization, DEFAULT_LIMIT);
  store.save(report);
  console.log(`\n=== ${title} ===`);
  console.log('报告 ID:', report.id);
  console.log('规范系数:', report.canonicalCoefficients);
  console.log('首项系数:', report.leadingCoefficient);
  for (const term of report.factors) {
    console.log(`不可约因子 ${JSON.stringify(term.factor)}，重数 ${term.multiplicity}`);
    console.log('  数学条件:');
    for (const condition of term.certificate.conditions) console.log(`  - ${condition}`);
    console.log('  GCD 检查:', term.certificate.checks.map((check) => `${check.condition} => gcd=${JSON.stringify(check.gcd)}`).join('; '));
  }
  console.log('独立核验:', verifyReport(report).valid);
}

const first = store.list()[0];
const original = store.get(first.id)!;
const tampered = JSON.parse(JSON.stringify(original));
if (tampered.factors[0]) tampered.factors[0].factor = ['0', '1', '1'];
const result = verifyReport(tampered);
console.log('\n=== 篡改演示 ===');
console.log('原哈希:', reportHash(original));
console.log('篡改哈希:', reportHash(tampered));
console.log('核验通过:', result.valid);
console.log('拒绝原因:', result.errors.join('; '));
store.logVerification(first.id, result.valid, result);
store.close();
