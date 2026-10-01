import { DomainError } from './errors.js';
import { MAX_EXPONENT, MAX_POLY_DEGREE, SUPPORTED_PRIMES } from './config.js';

export type Poly = bigint[];

export type Budget = {
  remaining: bigint;
  spent: bigint;
};

export function createBudget(initial: bigint): Budget {
  return { remaining: initial, spent: 0n };
}

export function charge(budget: Budget, cost: bigint): void {
  if (cost > budget.remaining) {
    budget.spent += budget.remaining;
    budget.remaining = 0n;
    throw new DomainError('BUDGET_EXCEEDED', '资源预算不足，分解已停止；不能将余因子标记为不可约');
  }
  budget.remaining -= cost;
  budget.spent += cost;
}

export function assertSupportedPrime(primeText: string): bigint {
  let p: bigint;
  try {
    p = BigInt(primeText);
  } catch {
    throw new DomainError('INVALID_INPUT', '模数必须是十进制整数字符串');
  }
  if (!SUPPORTED_PRIMES.some((q) => q === p)) {
    throw new DomainError('COMPOSITE_MODULUS', `仅支持经过验证的小素数模数：${SUPPORTED_PRIMES.map(String).join(', ')}`);
  }
  return p;
}

export function mod(a: bigint, p: bigint): bigint {
  const r = a % p;
  return r < 0n ? r + p : r;
}

export function canonicalFromText(coefficients: string[], p: bigint): Poly {
  if (!Array.isArray(coefficients) || coefficients.length === 0) {
    throw new DomainError('INVALID_INPUT', '系数数组不能为空；零多项式请给出 ["0"]');
  }
  if (coefficients.length > MAX_POLY_DEGREE + 1) {
    throw new DomainError('INVALID_DEGREE', `次数超过公开上限 ${MAX_POLY_DEGREE}`);
  }
  const poly = coefficients.map((value) => {
    try {
      return mod(BigInt(value), p);
    } catch {
      throw new DomainError('INVALID_INPUT', '所有系数必须是十进制整数字符串');
    }
  });
  return trim(poly);
}

export function trim(poly: Poly): Poly {
  const result = [...poly];
  while (result.length > 1 && result[result.length - 1] === 0n) result.pop();
  return result.length === 0 ? [0n] : result;
}

export function degree(poly: Poly): number {
  return poly.length === 1 && poly[0] === 0n ? -1 : poly.length - 1;
}
export function leadingCoefficient(poly: Poly): bigint {
  return poly[poly.length - 1];
}
export function isZero(poly: Poly): boolean {
  return degree(poly) === -1;
}
export function isOne(poly: Poly): boolean {
  return poly.length === 1 && poly[0] === 1n;
}
export function samePoly(a: Poly, b: Poly): boolean {
  const x = trim(a);
  const y = trim(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
export function clonePoly(poly: Poly): Poly {
  return [...poly];
}
export function polyToText(poly: Poly): string[] {
  return trim(poly).map((value) => value.toString());
}

export function inverse(a: bigint, p: bigint): bigint {
  const value = mod(a, p);
  if (value === 0n) throw new DomainError('ZERO_DIVISOR', '零在素数域中没有乘法逆元');
  let [oldR, r] = [p, value];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldT, t] = [t, oldT - q * t];
  }
  if (oldR !== 1n) throw new DomainError('COMPOSITE_MODULUS', '模数不是素数，无法求逆');
  return mod(oldT, p);
}

export function add(a: Poly, b: Poly, p: bigint): Poly {
  const n = Math.max(a.length, b.length);
  const result: Poly = Array.from({ length: n }, (_, i) => mod((a[i] ?? 0n) + (b[i] ?? 0n), p));
  return trim(result);
}
export function subtract(a: Poly, b: Poly, p: bigint): Poly {
  const n = Math.max(a.length, b.length);
  const result: Poly = Array.from({ length: n }, (_, i) => mod((a[i] ?? 0n) - (b[i] ?? 0n), p));
  return trim(result);
}
export function multiply(a: Poly, b: Poly, p: bigint): Poly {
  if (isZero(a) || isZero(b)) return [0n];
  const result: Poly = Array.from({ length: a.length + b.length - 1 }, () => 0n);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) result[i + j] = mod(result[i + j] + a[i] * b[j], p);
  }
  return trim(result);
}
export function scalarMultiply(a: Poly, scalar: bigint, p: bigint): Poly {
  const s = mod(scalar, p);
  if (s === 0n) return [0n];
  return trim(a.map((v) => mod(v * s, p)));
}

export function divmod(aInput: Poly, bInput: Poly, p: bigint): { quotient: Poly; remainder: Poly } {
  const b = trim(bInput);
  if (isZero(b)) throw new DomainError('ZERO_DIVISOR', '多项式除法除以零');
  const a = trim(aInput);
  if (degree(a) < degree(b)) return { quotient: [0n], remainder: a };
  const remainder = clonePoly(a);
  const quotient: Poly = Array.from({ length: degree(a) - degree(b) + 1 }, () => 0n);
  const invLead = inverse(leadingCoefficient(b), p);
  while (degree(remainder) >= degree(b)) {
    const shift = degree(remainder) - degree(b);
    const coefficient = mod(leadingCoefficient(remainder) * invLead, p);
    quotient[shift] = coefficient;
    for (let i = 0; i < b.length; i++) remainder[i + shift] = mod(remainder[i + shift] - coefficient * b[i], p);
    const trimmed = trim(remainder);
    remainder.splice(0, remainder.length, ...trimmed);
  }
  return { quotient: trim(quotient), remainder: trim(remainder) };
}
export function divides(a: Poly, b: Poly, p: bigint): boolean {
  return isZero(divmod(b, a, p).remainder);
}
export function monic(a: Poly, p: bigint): Poly {
  if (isZero(a)) return [0n];
  const inv = inverse(leadingCoefficient(a), p);
  return scalarMultiply(a, inv, p);
}
export function gcd(aInput: Poly, bInput: Poly, p: bigint): Poly {
  let a = monic(trim(aInput), p);
  let b = monic(trim(bInput), p);
  while (!isZero(b)) {
    const r = divmod(a, b, p).remainder;
    a = b;
    b = r;
  }
  return monic(a, p);
}
export function derivative(a: Poly, p: bigint): Poly {
  const result: Poly = Array.from({ length: Math.max(0, a.length - 1) }, (_, i) => mod(BigInt(i + 1) * a[i + 1], p));
  return trim(result.length ? result : [0n]);
}
export function powerMod(base: Poly, exponent: bigint, modulusPoly: Poly, p: bigint, budget: Budget): Poly {
  if (exponent < 0n) throw new DomainError('INVALID_INPUT', '指数不能为负');
  if (exponent > BigInt(MAX_EXPONENT) ** 2n) throw new DomainError('INVALID_DEGREE', '指数超过安全上限');
  if (isZero(modulusPoly)) throw new DomainError('ZERO_DIVISOR', '模幂的模数多项式不能为零');
  let result: Poly = [1n];
  let current = divmod(base, modulusPoly, p).remainder;
  let e = exponent;
  while (e > 0n) {
    charge(budget, BigInt(current.length * modulusPoly.length));
    if (e & 1n) result = divmod(multiply(result, current, p), modulusPoly, p).remainder;
    e >>= 1n;
    if (e > 0n) current = divmod(multiply(current, current, p), modulusPoly, p).remainder;
  }
  return result;
}
export function pthRoot(a: Poly, p: bigint): Poly {
  const values: Poly = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0n) {
      if (i % Number(p) !== 0) throw new DomainError('INVALID_INPUT', '导数为零的多项式不是 p 次幂，无法抽取 p 次根');
      values[i / Number(p)] = a[i];
    }
  }
  return trim(values.length ? values : [0n]);
}
