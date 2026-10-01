import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FiniteField, SUPPORTED_PRIMES } from '../src/core/finiteField';
import {
  canonicalize,
  mul,
  degree,
  isZero,
  power,
  scalarMul,
  mod,
} from '../src/core/polynomial';
import { factorize } from '../src/core/factorize';
import { rabinTest } from '../src/core/irreducible';
import { squareFreeFactorization } from '../src/core/squarefree';

/** 在 F_p[x] 中枚举所有次数 <= maxD 的首一多项式（暴力列不可约因子）。 */
/** 生成 F_p 上全部次数恰为 d 的首一多项式（升幂，末位=1）。 */
function allMonic(p: number, d: number): number[][] {
  if (d === 0) return [[]];
  // d 次首一多项式：低 d 个系数自由枚举，最高位固定为 1。
  const total = Math.pow(p, d);
  const out: number[][] = [];
  for (let n = 0; n < total; n++) {
    const coeffs = new Array(d).fill(0);
    let x = n;
    for (let i = 0; i < d; i++) {
      coeffs[i] = x % p;
      x = Math.floor(x / p);
    }
    coeffs.push(1);
    out.push(coeffs);
  }
  return out;
}

/** 通过试除所有次数 <= n/2 的首一多项式暴力判定不可约。 */
function bruteIrreducible(field: FiniteField, f: number[]): boolean {
  const n = degree(f);
  if (n <= 0) return false;
  if (n === 1) return true;
  for (let d = 1; d <= Math.floor(n / 2); d++) {
    for (const cand of allMonic(field.p, d)) {
      const poly = canonicalize(field, cand);
      if (isZero(mod(field, f, poly))) return false;
    }
  }
  return true;
}

test('Rabin 判定与暴力枚举一致（F_2、F_3、F_5 上全部次数<=4 首一多项式）', () => {
  for (const p of [2, 3, 5]) {
    const field = new FiniteField(p);
    for (let d = 1; d <= 4; d++) {
      for (const coeffs of allMonic(p, d)) {
        const f = canonicalize(field, coeffs);
        const rabin = rabinTest(field, f).irreducible;
        const brute = bruteIrreducible(field, f);
        assert.equal(rabin, brute, `p=${p} f=${JSON.stringify(f)}`);
      }
    }
  }
});

test('不可约二次与三次被正确识别并带证书', () => {
  const field = new FiniteField(3);
  const r = factorize(field, canonicalize(field, [1, 0, 1])); // x^2+1
  assert.equal(r.complete, true);
  assert.equal(r.factors.length, 1);
  assert.deepEqual(r.factors[0].factor, [1, 0, 1]);
  assert.equal(r.factors[0].certificate.n, 2);

  // F_2 上 x^3+x+1 不可约
  const f2 = new FiniteField(2);
  const r2 = factorize(f2, canonicalize(f2, [1, 1, 0, 1]));
  assert.equal(r2.factors.length, 1);
  assert.equal(r2.factors[0].certificate.n, 3);
});

test('完全分裂：x^6-1 在 F_7 上分裂为六个一次因子', () => {
  const field = new FiniteField(7);
  const r = factorize(field, canonicalize(field, [6, 0, 0, 0, 0, 0, 1]));
  assert.equal(r.factors.length, 6);
  assert.ok(r.factors.every((f) => degree(f.factor) === 1 && f.multiplicity === 1));
});

test('多重因子：F_2 上 (x+1)^2 = x^2+1，导数为零仍抽出重数 2', () => {
  const field = new FiniteField(2);
  const poly = canonicalize(field, [1, 0, 1]);
  const sf = squareFreeFactorization(field, poly);
  assert.deepEqual(sf, [{ factor: [1, 1], multiplicity: 2 }]);
  const r = factorize(field, poly);
  assert.equal(r.factors.length, 1);
  assert.equal(r.factors[0].multiplicity, 2);
});

test('混合重数：F_3 上 (x^2+1)^2 * (x-1)', () => {
  const field = new FiniteField(3);
  const a = canonicalize(field, [1, 0, 1]);
  const b = canonicalize(field, [2, 1]); // x-1
  const poly = mul(field, power(field, a, 2), b);
  const r = factorize(field, poly);
  assert.equal(r.factors.length, 2);
  const byDeg = Object.fromEntries(r.factors.map((f) => [degree(f.factor), f.multiplicity]));
  assert.equal(byDeg[2], 2);
  assert.equal(byDeg[1], 1);
});

test('小特征高次 p 次幂：F_2 上 (x^2+x+1)^4 重数传播为 4', () => {
  const field = new FiniteField(2);
  const base = canonicalize(field, [1, 1, 1]);
  const poly = power(field, base, 4);
  const r = factorize(field, poly);
  assert.equal(r.factors.length, 1);
  assert.deepEqual(r.factors[0].factor, [1, 1, 1]);
  assert.equal(r.factors[0].multiplicity, 4);
});

test('乘非零标量不改变首一因子；系数加模数结果不变；输入重排表示规范', () => {
  const field = new FiniteField(5);
  const base = canonicalize(field, [1, 2, 1]); // (x+1)^2
  const scaled = scalarMul(field, base, 3);
  const rA = factorize(field, scaled);
  const rB = factorize(field, base);
  assert.deepEqual(rA.factors.map((f) => f.factor), rB.factors.map((f) => f.factor));
  assert.equal(rA.leading_coefficient, '3');

  // 系数加模数不影响
  const plusP = canonicalize(field, base.map((c) => c + field.p));
  assert.deepEqual(plusP, base);

  // 尾随零与升幂重排等价
  assert.deepEqual(canonicalize(field, [1, 2, 1, 0, 0]), base);
});

test('受支持素数白名单存在且 2 在内', () => {
  assert.ok(SUPPORTED_PRIMES.includes(2));
  assert.ok(SUPPORTED_PRIMES.includes(47));
  assert.throws(() => new FiniteField(4), /合数|素数/);
});

test('除零明确报错而非静默', () => {
  const field = new FiniteField(7);
  assert.throws(() => field.inv(0), /零/);
});
