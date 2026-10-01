import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { factorPolynomial, certifyIrreducible } from '../src/factor.js';
import {
  canonicalFromText, divides, divmod, gcd, isOne, isZero, monic, multiply, Poly, trim
} from '../src/finiteField.js';
import { buildReport, canonicalJson, verifyReport } from '../src/report.js';
import { ReportStore } from '../src/store.js';

const p2 = 2n;
const p3 = 3n;
const termsOf = (poly: Poly, p: bigint) => factorPolynomial(poly, p).factors.map((t) => ({ factor: t.factor.map(String), multiplicity: t.multiplicity }));

function enumerateDivisors(f: Poly, p: bigint): Poly[] {
  const n = f.length - 1;
  const divisors: Poly[] = [];
  const walk = (poly: Poly) => {
    const d = poly.length - 1;
    if (d > 0 && d * 2 <= n && divides(monic(poly, p), f, p)) divisors.push(monic(poly, p));
    if (poly.length < Math.floor(n / 2) + 1) {
      for (let c = 0n; c < p; c++) walk([...poly, c]);
    }
  };
  for (let c0 = 0n; c0 < p; c0++) for (let lead = 1n; lead < p; lead++) walk([c0, lead]);
  return divisors;
}

test('二次和三次不可约多项式通过独立枚举与证书', () => {
  const quadratic = canonicalFromText(['1', '1', '1'], p2);
  assert.deepEqual(termsOf(quadratic, p2), [{ factor: ['1', '1', '1'], multiplicity: 1 }]);
  assert.equal(enumerateDivisors(quadratic, p2).length, 0);
  const cubic = canonicalFromText(['1', '1', '0', '1'], p2);
  assert.deepEqual(termsOf(cubic, p2), [{ factor: ['1', '1', '0', '1'], multiplicity: 1 }]);
  assert.equal(enumerateDivisors(cubic, p2).length, 0);
  assert.ok(verifyReport(buildReport('2', ['1', '1', '1'], factorPolynomial(quadratic, p2), 500000n)).valid);
});

test('完全分裂、多重因子和混合重数', () => {
  const x1: Poly = [1n, 1n];
  const x2: Poly = [2n, 1n];
  const split = multiply(x1, x2, p3);
  assert.deepEqual(termsOf(split, p3), [{ factor: ['1', '1'], multiplicity: 1 }, { factor: ['2', '1'], multiplicity: 1 }]);
  const repeated = multiply(x1, x1, p3);
  assert.deepEqual(termsOf(repeated, p3), [{ factor: ['1', '1'], multiplicity: 2 }]);
  const mixed = multiply(multiply(x1, x1, p3), x2, p3);
  assert.deepEqual(termsOf(mixed, p3), [{ factor: ['1', '1'], multiplicity: 2 }, { factor: ['2', '1'], multiplicity: 1 }]);
});

test('小特征导数为零时抽取 p 次根并传播重数', () => {
  assert.deepEqual(termsOf(canonicalFromText(['1', '0', '1'], p2), p2), [{ factor: ['1', '1'], multiplicity: 2 }]);
  assert.deepEqual(termsOf(canonicalFromText(['1', '0', '0', '1'], p3), p3), [{ factor: ['1', '1'], multiplicity: 3 }]);
});

test('非零标量和系数加模数不改变首一因子，输入表示规范化', () => {
  const base = canonicalFromText(['2', '0', '1'], p3);
  const scaled = multiply(base, [2n], p3);
  const shifted = base.map((v) => v + 3n);
  assert.deepEqual(termsOf(scaled, p3), termsOf(base, p3));
  assert.deepEqual(termsOf(shifted, p3), termsOf(base, p3));
  const a = canonicalFromText(['0', '1', '1', '0'], p2);
  const b = canonicalFromText(['2', '3', '1'], p2);
  assert.deepEqual(a, b);
});

test('乘积正确但包含可约因子的假证书被拒绝', () => {
  const p = p2;
  const irreducible = canonicalFromText(['1', '1', '1'], p);
  const fakeFactor = canonicalFromText(['1', '0', '0', '1'], p);
  const real = factorPolynomial(fakeFactor, p).factors[0].factor;
  assert.ok(!isOne(gcd(fakeFactor, [0n, 1n], p)) || real.length !== fakeFactor.length);
  const report = buildReport('2', ['1', '1', '1'], factorPolynomial(irreducible, p), 500000n);
  const fake = JSON.parse(JSON.stringify(report));
  fake.factors = [{ factor: fakeFactor.map(String), multiplicity: 1, certificate: certifyIrreducible(irreducible, p) }];
  const result = verifyReport(fake);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('Frobenius')));
});

test('报告在重新打开 SQLite 后仍可独立复核', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffpoly-'));
  const dbPath = join(dir, 'test.db');
  const poly = canonicalFromText(['1', '1', '1'], p2);
  const report = buildReport('2', ['1', '1', '1'], factorPolynomial(poly, p2), 500000n);
  new ReportStore(dbPath).save(report);
  const reopened = new ReportStore(dbPath);
  after(() => reopened.close());
  const loaded = reopened.get(report.id);
  assert.ok(loaded);
  assert.equal(canonicalJson(loaded), canonicalJson(report));
  assert.equal(verifyReport(loaded).valid, true);
});

test('零多项式和非零常数语义明确', () => {
  const zero = buildReport('2', ['0', '0'], { factors: [], certificates: [], budgetSpent: '0', budgetLimit: '500000' }, 500000n);
  assert.deepEqual(zero.factors, []);
  assert.equal(zero.inputKind, 'zero');
  const constant = buildReport('5', ['7'], { factors: [], certificates: [], budgetSpent: '0', budgetLimit: '500000' }, 500000n);
  assert.equal(constant.inputKind, 'nonzero_constant');
  assert.equal(constant.leadingCoefficient, '2');
  assert.ok(verifyReport(zero).valid);
  assert.ok(verifyReport(constant).valid);
});
