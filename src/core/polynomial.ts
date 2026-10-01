import { FiniteField } from './finiteField';
import { DomainError } from './errors';

/**
 * 多项式采用「升幂系数数组」规范表示：
 * coeffs[i] 为 x^i 的系数；统一模 p 约简；去除尾随零；
 * 零多项式表示为 []（degree = -1）。
 */
export type Poly = number[];

export function canonicalize(field: FiniteField, raw: Array<number | string>): Poly {
  if (!Array.isArray(raw)) {
    throw new DomainError('INVALID_INPUT', '系数必须为数组');
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (typeof token === 'boolean' || (typeof token !== 'number' && typeof token !== 'string')) {
      throw new DomainError('INVALID_COEFFICIENT', `第 ${i} 项系数类型非法`);
    }
    const value = typeof token === 'number' ? token : Number(token);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new DomainError('INVALID_COEFFICIENT', `第 ${i} 项系数必须为整数字符串/数字`);
    }
    out.push(field.mod(value));
  }
  trimZero(out);
  return out;
}

export function trimZero(a: Poly): void {
  while (a.length > 0 && a[a.length - 1] === 0) a.pop();
}

export function isZero(a: Poly): boolean {
  return a.length === 0;
}

export function degree(a: Poly): number {
  return a.length - 1;
}

export function clone(a: Poly): Poly {
  return a.slice();
}

export function leadingCoeff(field: FiniteField, a: Poly): number {
  if (isZero(a)) {
    throw new DomainError('ZERO_POLYNOMIAL', '零多项式没有首项系数');
  }
  return field.mod(a[a.length - 1]);
}

export function add(field: FiniteField, a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out: Poly = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] = field.add(a[i] ?? 0, b[i] ?? 0);
  }
  trimZero(out);
  return out;
}

export function sub(field: FiniteField, a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out: Poly = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] = field.sub(a[i] ?? 0, b[i] ?? 0);
  }
  trimZero(out);
  return out;
}

export function mul(field: FiniteField, a: Poly, b: Poly): Poly {
  if (isZero(a) || isZero(b)) return [];
  const out: Poly = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] = field.add(out[i + j], field.mul(a[i], b[j]));
    }
  }
  trimZero(out);
  return out;
}

export function scalarMul(field: FiniteField, a: Poly, c: number): Poly {
  if (field.mod(c) === 0 || isZero(a)) return [];
  return a.map((x) => field.mul(x, c));
}

/** 返回 { q, r } 使 a = q*b + r，deg r < deg b。 */
export function divmod(field: FiniteField, a: Poly, b: Poly): { q: Poly; r: Poly } {
  if (isZero(b)) {
    throw new DomainError('DIVISION_BY_ZERO', '多项式除法遇到零除式');
  }
  let r = clone(a);
  const q: Poly = new Array(Math.max(0, a.length - b.length + 1)).fill(0);
  const lb = b[b.length - 1];
  while (!isZero(r) && r.length >= b.length) {
    const shift = r.length - b.length;
    const coef = field.div(r[r.length - 1], lb);
    q[shift] = field.add(q[shift], coef);
    for (let j = 0; j < b.length; j++) {
      r[j + shift] = field.sub(r[j + shift], field.mul(coef, b[j]));
    }
    trimZero(r);
  }
  trimZero(q);
  return { q, r };
}

export function mod(field: FiniteField, a: Poly, m: Poly): Poly {
  return divmod(field, a, m).r;
}

/** 多项式欧几里得 GCD，结果经首一化。 */
export function gcd(field: FiniteField, a: Poly, b: Poly): Poly {
  let x = clone(a);
  let y = clone(b);
  while (!isZero(y)) {
    const r = mod(field, x, y);
    x = y;
    y = r;
  }
  return monic(field, x);
}

/** 首一化：除以首项系数；零多项式保持为零。 */
export function monic(field: FiniteField, a: Poly): Poly {
  if (isZero(a)) return [];
  const lc = a[a.length - 1];
  if (lc === 1) return clone(a);
  const inv = field.inv(lc);
  const out = a.map((x) => field.mul(x, inv));
  out[out.length - 1] = 1;
  trimZero(out);
  return out;
}

/** 形式导数（特征 p 下可能为零多项式，绝不据此断言无重根）。 */
export function derivative(field: FiniteField, a: Poly): Poly {
  if (a.length <= 1) return [];
  const out: Poly = new Array(a.length - 1).fill(0);
  for (let i = 1; i < a.length; i++) {
    out[i - 1] = field.mul(i, a[i]);
  }
  trimZero(out);
  return out;
}

/**
 * Frobenius：返回 a^exp mod m，指数为普通大整数（内部 BigInt 位运算）。
 * 用于 Rabin 不可约判定 x^{p^i} mod f。
 */
export function powMod(field: FiniteField, base: Poly, exp: bigint, m: Poly): Poly {
  if (isZero(m)) {
    throw new DomainError('DIVISION_BY_ZERO', 'powMod 模数为零多项式');
  }
  let result: Poly = [1];
  let b = mod(field, base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(field, mul(field, result, b), m);
    b = mod(field, mul(field, b, b), m);
    e >>= 1n;
  }
  return result;
}

/** a 的 k 次幂（不带模），用于乘积重建。 */
export function power(field: FiniteField, a: Poly, k: number): Poly {
  let result: Poly = [1];
  for (let i = 0; i < k; i++) result = mul(field, result, a);
  return result;
}

/**
 * 若 a 是 F_p 上某个多项式的 p 次幂则返回该 p 次根，否则 null。
 * 导数恒为零 当且仅当 仅含 x^p 幂次项（即存在 b 使 a = b^p）。
 */
export function pthRoot(field: FiniteField, a: Poly, p: number): Poly | null {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0 && i % p !== 0) return null;
  }
  const root: Poly = [];
  for (let i = 0; i < a.length; i += p) {
    root[i / p] = a[i] ?? 0;
  }
  trimZero(root);
  return root;
}

/** 规范排序键：先比次数，再按高次到低次系数字典序比较。 */
export function compareFactor(a: Poly, b: Poly): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function coefficientsAsStrings(a: Poly): string[] {
  return a.map((x) => x.toString());
}

export function assertLegalDegree(a: Poly, maxDegree: number): void {
  if (degree(a) > maxDegree) {
    throw new DomainError(
      'ILLEGAL_DEGREE',
      `次数 ${degree(a)} 超过公开上限 ${maxDegree}`,
    );
  }
}
