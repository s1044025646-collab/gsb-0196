import { createHash } from 'node:crypto';
import { FiniteField } from './finiteField';
import { DomainError } from './errors';
import {
  Poly,
  add,
  compareFactor,
  degree,
  divmod,
  gcd,
  monic,
  mul,
  powMod,
  scalarMul,
  sub,
} from './polynomial';
import { rabinTest, RabinCertificate } from './irreducible';
import { squareFreeFactorization, SquareFreeFactor } from './squarefree';

export const MAX_DEGREE = 60;
export const ALGORITHM_VERSION = 'gf-factor:rabin-ddf-edf-v1';

export interface IrredFactor {
  factor: Poly;
  multiplicity: number;
  certificate: RabinCertificate;
}

export interface FactorizationResult {
  p: number;
  original_coeffs: string[];
  canonical_coeffs: string[];
  leading_coefficient: string;
  factors: IrredFactor[];
  complete: boolean;
  residual?: Poly;
  algorithm_version: string;
}

export interface Budget {
  maxDegree: number;
  maxOperations: number;
  operations: number;
}

export function createBudget(maxDegree = MAX_DEGREE, maxOperations = 4_000_000): Budget {
  return { maxDegree, maxOperations, operations: 0 };
}

function tick(budget: Budget, n = 1): void {
  budget.operations += n;
  if (budget.operations > budget.maxOperations) {
    throw new DomainError(
      'BUDGET_EXCEEDED',
      `操作数超过资源预算 ${budget.maxOperations}；分解标记为未完成`,
    );
  }
}

/** 由输入与固定盐派生确定性伪随机序列，保证可复现。 */
function deterministicRng(seedText: string): () => number {
  const hex = createHash('sha256').update(seedText).digest('hex').slice(0, 8);
  let state = (parseInt(hex, 16) >>> 0) || 1;
  return () => {
    // Knuth 常数 LCG（模 2^32），确定性且周期充足。
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 构造确定性随机多项式（次数 < deg(f)）。 */
function randomPoly(field: FiniteField, maxDegExclusive: number, rng: () => number): Poly {
  const coeffs: Poly = [];
  for (let i = 0; i < maxDegExclusive; i++) {
    coeffs.push(Math.floor(rng() * field.p) % field.p);
  }
  coeffs.push(0);
  while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) coeffs.pop();
  return coeffs;
}

/**
 * 不同度分解（DDF）：输入首一平方自由 f，输出形如 {h, d} 的乘积，
 * h 是所有次数为 d 的不可约因子之积。
 */
function distinctDegreeFactors(field: FiniteField, f: Poly, budget: Budget): { h: Poly; d: number }[] {
  const out: { h: Poly; d: number }[] = [];
  let h = monic(field, f);
  let k = 0;
  let xqi: Poly = [0, 1]; // x^{p^k} mod h，初始 k=0 即 x
  while (degree(h) > 1) {
    k++;
    xqi = powMod(field, xqi, BigInt(field.p), h);
    tick(budget, degree(h) * degree(h));
    const g = gcd(field, h, sub(field, xqi, [0, 1]));
    if (degree(g) > 0) {
      out.push({ h: g, d: k });
      h = monic(field, divmod(field, h, g).q);
      if (degree(h) > 1) {
        xqi = [0, 1];
        for (let i = 0; i < k; i++) xqi = powMod(field, xqi, BigInt(field.p), h);
      }
    }
  }
  if (degree(h) === 1) {
    out.push({ h, d: 1 });
  } else if (degree(h) > 1) {
    // 剩余首一多项式本身不可约，其次数即因子次数。
    out.push({ h, d: degree(h) });
  }
  return out;
}

/**
 * 等度分解（EDF）：把首一平方自由、所有不可约因子次数均为 d 的 h
 * 拆成不可约因子。p=2 使用 (T r)^{2^{d-1}}，奇素数使用 T^{(p^d-1)/2}。
 */
function equalDegreeSplit(
  field: FiniteField,
  h: Poly,
  d: number,
  rng: () => number,
  budget: Budget,
): Poly[] {
  const n = degree(h);
  if (n === d) return [monic(field, h)];
  // d=1：直接在 F_p 中枚举根，确定性最强，便于独立核对。
  if (d === 1) {
    const result: Poly[] = [];
    for (let a = 0; a < field.p; a++) {
      tick(budget, n);
      let evalv = 0;
      let pk = 1;
      for (let i = 0; i < h.length; i++) {
        evalv = (evalv + h[i] * pk) % field.p;
        pk = (pk * a) % field.p;
      }
      if (evalv === 0) result.push(monic(field, [field.sub(0, a), 1]));
    }
    return result;
  }
  let attempt = 0;
  while (attempt++ < 64) {
    tick(budget, n * n);
    const t = randomPoly(field, n - 1, rng);
    let power: Poly;
    if (field.p === 2) {
      // 迹 Tr(T) = T + T^2 + T^{2^2} + ... + T^{2^{d-1}} (mod h)
      let trace = mod(field, t, h);
      let cur = mod(field, t, h);
      for (let i = 0; i < d - 1; i++) {
        cur = powMod(field, cur, 2n, h);
        trace = add(field, trace, cur);
      }
      power = trace;
    } else {
      const exp = (powBig(BigInt(field.p), BigInt(d)) - 1n) / 2n;
      power = powMod(field, t, exp, h);
    }
    const g = gcd(field, h, sub(field, power, [1]));
    if (degree(g) > 0 && degree(g) < n) {
      const left = monic(field, g);
      const right = monic(field, divmod(field, h, g).q);
      return [
        ...equalDegreeSplit(field, left, d, rng, budget),
        ...equalDegreeSplit(field, right, d, rng, budget),
      ];
    }
  }
  throw new DomainError('BUDGET_EXCEEDED', `等度分裂在预算内未成功（d=${d}）`);
}

function mod(field: FiniteField, a: Poly, m: Poly): Poly {
  return divmod(field, a, m).r;
}

function powBig(base: bigint, exp: bigint): bigint {
  let r = 1n;
  let b = base;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r *= b;
    b *= b;
    e >>= 1n;
  }
  return r;
}

/** 主分解入口。poly 为已规范化（模 p、去尾零）系数。 */
export function factorize(
  field: FiniteField,
  poly: Poly,
  budget = createBudget(),
): FactorizationResult {
  if (degree(poly) > budget.maxDegree) {
    throw new DomainError('ILLEGAL_DEGREE', `次数 ${degree(poly)} 超过公开上限 ${budget.maxDegree}`);
  }

  const lc = poly[poly.length - 1];
  const monicPoly = scalarMul(field, poly, field.inv(lc));
  const seedText = `${field.p}:${JSON.stringify(monicPoly)}:${ALGORITHM_VERSION}`;

  const sfGroups: SquareFreeFactor[] = squareFreeFactorization(field, monicPoly);
  const factors: IrredFactor[] = [];
  let complete = true;
  let residual: Poly | undefined;

  for (const group of sfGroups) {
    if (rabinTest(field, group.factor).irreducible && degree(group.factor) > 0) {
      const { certificate } = rabinTest(field, group.factor, true);
      factors.push({ factor: monic(field, group.factor), multiplicity: group.multiplicity, certificate: certificate! });
      continue;
    }
    const rng = deterministicRng(seedText + `:${JSON.stringify(group.factor)}`);
    const ddfs = distinctDegreeFactors(field, group.factor, budget);
    for (const { h, d } of ddfs) {
      const irreducibles = equalDegreeSplit(field, h, d, rng, budget);
      for (const irr of irreducibles) {
        const test = rabinTest(field, irr, true);
        if (!test.irreducible) {
          complete = false;
          residual = residual ? mul(field, residual, irr) : irr;
          continue;
        }
        factors.push({ factor: monic(field, irr), multiplicity: group.multiplicity, certificate: test.certificate! });
      }
    }
  }

  factors.sort((a, b) => compareFactor(a.factor, b.factor));

  return {
    p: field.p,
    original_coeffs: poly.map((c) => c.toString()),
    canonical_coeffs: monicPoly.map((c) => c.toString()),
    leading_coefficient: lc.toString(),
    factors,
    complete,
    residual,
    algorithm_version: ALGORITHM_VERSION,
  };
}
