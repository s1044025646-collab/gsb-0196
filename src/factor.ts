import { ALGORITHM_VERSION, MAX_POLY_DEGREE } from './config.js';
import { DomainError } from './errors.js';
import {
  Budget, charge, createBudget, degree, divides, divmod, gcd, inverse, isOne, isZero,
  monic, multiply, Poly, powerMod, pthRoot, samePoly, scalarMultiply, subtract, trim
} from './finiteField.js';

export type FactorTerm = { factor: Poly; multiplicity: number };
export type CertCheck = {
  degree: number;
  primeDivisor: number | null;
  leftResidue: string[];
  rightResidue: string[];
  gcd: string[];
  condition: string;
};
export type IrreducibleCertificate = {
  factor: string[];
  degree: number;
  prime: string;
  conditions: string[];
  checks: CertCheck[];
};
export type Factorization = {
  factors: FactorTerm[];
  certificates: IrreducibleCertificate[];
  budgetSpent: string;
  budgetLimit: string;
};

const xPoly: Poly = [0n, 1n];

function comparePoly(a: Poly, b: Poly): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export function sortTerms(terms: FactorTerm[]): FactorTerm[] {
  return [...terms].sort((a, b) => comparePoly(a.factor, b.factor));
}
function combine(terms: FactorTerm[]): FactorTerm[] {
  const map = new Map<string, FactorTerm>();
  for (const term of terms) {
    const key = JSON.stringify(term.factor.map(String));
    const old = map.get(key);
    if (old) old.multiplicity += term.multiplicity;
    else map.set(key, { factor: term.factor, multiplicity: term.multiplicity });
  }
  return sortTerms([...map.values()]);
}

function encodeCandidate(nonce: number, p: bigint, degreeBound: number): Poly {
  let value = nonce;
  const poly: Poly = [0n];
  for (let i = 0; i < degreeBound; i++) {
    poly[i] = BigInt(value % Number(p));
    value = Math.floor(value / Number(p));
  }
  if (value !== 0) throw new DomainError('BUDGET_EXCEEDED', '确定性候选空间已耗尽，资源预算不足');
  return trim(poly);
}

function tracePowerTwo(a: Poly, d: number, modPoly: Poly, p: bigint, budget: Budget): Poly {
  let trace = trim(a);
  let current = trim(a);
  for (let i = 1; i < d; i++) {
    current = powerMod(current, 2n, modPoly, p, budget);
    trace = trim(trace.map((v, i2) => ((trace[i2] ?? 0n) + (current[i2] ?? 0n)) % p));
  }
  return trace;
}

function equalDegreeSplit(product: Poly, d: number, p: bigint, budget: Budget): Poly {
  const n = degree(product);
  const maxCandidates = Number(BigInt(DEFAULT_LIMIT) / 100n);
  for (let nonce = 1; nonce <= maxCandidates; nonce++) {
    const a = encodeCandidate(nonce, p, n);
    if (isZero(a) || (a.length === 1)) continue;
    let candidate: Poly;
    if (p === 2n) {
      candidate = tracePowerTwo(a, d, product, p, budget);
    } else {
      const exponent = (p ** BigInt(d) - 1n) / 2n;
      candidate = subtract(powerMod(a, exponent, product, p, budget), [1n], p);
    }
    const g = gcd(product, candidate, p);
    charge(budget, BigInt(n * n));
    if (!isOne(g) && !samePoly(g, product)) return g;
  }
  throw new DomainError('BUDGET_EXCEEDED', '等度因子拆分未能在预算内完成；余因子不得标记为不可约');
}

function equalDegreeFactor(productInput: Poly, d: number, p: bigint, budget: Budget): Poly[] {
  const product = monic(productInput, p);
  if (degree(product) === d) return [product];
  const split = equalDegreeSplit(product, d, p, budget);
  const left = equalDegreeFactor(split, d, p, budget);
  const right = equalDegreeFactor(divmod(product, split, p).quotient, d, p, budget);
  return [...left, ...right].sort(comparePoly);
}

function distinctDegreeFactor(f: Poly, p: bigint, budget: Budget): Poly[] {
  let h = monic(f, p);
  let x = xPoly;
  const irreducibles: Poly[] = [];
  const total = degree(h);
  for (let d = 1; d <= total && !isOne(h); d++) {
    x = powerMod(x, p, h, p, budget);
    const g = gcd(h, subtract(x, xPoly, p), p);
    charge(budget, BigInt(degree(h) * d));
    if (!isOne(g)) {
      irreducibles.push(...equalDegreeFactor(g, d, p, budget));
      h = divmod(h, g, p).quotient;
      x = divmod(x, h, p).remainder;
    }
  }
  if (!isOne(h)) throw new DomainError('BUDGET_EXCEEDED', '不同度提取未完成，余因子仍可能可约');
  return irreducibles.sort(comparePoly);
}

function factorSquarefree(f: Poly, p: bigint, budget: Budget): Poly[] {
  const poly = monic(f, p);
  const n = degree(poly);
  if (n <= 0) return [];
  if (n > MAX_POLY_DEGREE) throw new DomainError('INVALID_DEGREE', `次数超过公开上限 ${MAX_POLY_DEGREE}`);
  if (n === 1) return [poly];
  return distinctDegreeFactor(poly, p, budget);
}

function factorMonic(fInput: Poly, p: bigint, budget: Budget, multiplicityScale = 1): FactorTerm[] {
  const f = monic(fInput, p);
  if (degree(f) <= 0) return [];
  const fp = derivativeLocal(f, p);
  if (isZero(fp)) {
    return factorMonic(pthRoot(f, p), p, budget, multiplicityScale).map((term) => ({
      factor: term.factor,
      multiplicity: term.multiplicity * Number(p)
    }));
  }
  const r = gcd(f, fp, p);
  if (isOne(r)) return factorSquarefree(f, p, budget).map((factor) => ({ factor, multiplicity: multiplicityScale }));
  const w = divmod(f, r, p).quotient;
  const common = gcd(w, r, p);
  const oncePart = divmod(w, common, p).quotient;
  const repeated = factorMonic(r, p, budget, multiplicityScale).map((term) => ({
    factor: term.factor,
    multiplicity: term.multiplicity + multiplicityScale
  }));
  const once = factorSquarefree(oncePart, p, budget).map((factor) => ({ factor, multiplicity: multiplicityScale }));
  return combine([...repeated, ...once]);
}

function derivativeLocal(a: Poly, p: bigint): Poly {
  const result: Poly = Array.from({ length: Math.max(0, a.length - 1) }, (_, i) => modLocal(BigInt(i + 1) * a[i + 1], p));
  return trim(result.length ? result : [0n]);
}
function modLocal(a: bigint, p: bigint): bigint { const r = a % p; return r < 0n ? r + p : r; }

export function factorPolynomial(poly: Poly, p: bigint, budgetLimit = DEFAULT_LIMIT): Factorization {
  const budget = createBudget(budgetLimit);
  const terms = factorMonic(poly, p, budget);
  const certificates = terms.map((term) => certifyIrreducible(term.factor, p, createBudget(budgetLimit)));
  return { factors: sortTerms(terms), certificates, budgetSpent: budget.spent.toString(), budgetLimit: budgetLimit.toString() };
}

export const DEFAULT_LIMIT = 500_000n;

function primeDivisors(n: number): number[] {
  const result: number[] = [];
  let value = n;
  for (let q = 2; q * q <= value; q++) {
    if (value % q === 0) {
      result.push(q);
      while (value % q === 0) value /= q;
    }
  }
  if (value > 1) result.push(value);
  return result;
}

export function certifyIrreducible(fInput: Poly, p: bigint, budget = createBudget(DEFAULT_LIMIT)): IrreducibleCertificate {
  const f = monic(fInput, p);
  const n = degree(f);
  if (n <= 0) throw new DomainError('INVALID_DEGREE', '不可约因子必须是非常数首一多项式');
  const checks: CertCheck[] = [];
  const conditions: string[] = [
    'f 在 F_p[x] 中为首一非常数多项式',
    '对 n 的每个素因子 q，gcd(f, x^(p^(n/q)) - x) = 1',
    'x^(p^n) ≡ x (mod f)'
  ];
  for (const q of primeDivisors(n)) {
    const left = powerMod(xPoly, p ** BigInt(n / q), f, p, budget);
    const right = xPoly;
    const g = gcd(f, subtract(left, right, p), p);
    if (!isOne(g)) throw new DomainError('INVALID_INPUT', 'Frobenius 检查失败：多项式可约');
    checks.push({ degree: n / q, primeDivisor: q, leftResidue: left.map(String), rightResidue: right.map(String), gcd: g.map(String), condition: `gcd(f, x^(p^(${n}/${q})) - x) = 1` });
  }
  const expectedX = divmod(xPoly, f, p).remainder;
  const finalLeft = powerMod(xPoly, p ** BigInt(n), f, p, budget);
  const finalDifference = subtract(finalLeft, expectedX, p);
  const finalGcd = gcd(f, finalDifference, p);
  if (!isZero(finalDifference) || !samePoly(finalGcd, f)) throw new DomainError('INVALID_INPUT', 'Frobenius 终检失败：多项式不可约性不成立');
  checks.push({ degree: n, primeDivisor: null, leftResidue: finalLeft.map(String), rightResidue: expectedX.map(String), gcd: finalGcd.map(String), condition: 'x^(p^n) ≡ x (mod f)，等价于 gcd(f, x^(p^n)-x)=f' });
  return { factor: f.map(String), degree: n, prime: p.toString(), conditions, checks };
}

export function reconstruct(terms: FactorTerm[], p: bigint, leading: bigint): Poly {
  let result: Poly = [modLocal(leading, p)];
  for (const term of terms) {
    for (let i = 0; i < term.multiplicity; i++) result = multiply(result, term.factor, p);
  }
  return result;
}
export { ALGORITHM_VERSION };
