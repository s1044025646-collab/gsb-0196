import { DomainError } from './errors';

/**
 * 受支持的小素数白名单。这些素数经过测试集核对；
 * 任意合数或白名单外素数都会被明确拒绝（资源与正确性预算可控）。
 */
export const SUPPORTED_PRIMES: readonly number[] = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
];

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

export function validatePrime(p: number): void {
  if (!Number.isInteger(p)) {
    throw new DomainError('INVALID_INPUT', `模数必须为整数，收到: ${String(p)}`);
  }
  if (!isPrime(p)) {
    throw new DomainError(
      'COMPOSITE_MODULUS',
      `模数 ${p} 不是素数；本服务仅在素数有限域 F_p 上工作`,
    );
  }
  if (!SUPPORTED_PRIMES.includes(p)) {
    throw new DomainError(
      'MODULUS_NOT_SUPPORTED',
      `素数 ${p} 超出受支持白名单 {${SUPPORTED_PRIMES.join(',')}}`,
    );
  }
}

/** 有限域 F_p 的加减乘除与约简。 */
export class FiniteField {
  readonly p: number;

  constructor(p: number) {
    validatePrime(p);
    this.p = p;
  }

  add(a: number, b: number): number {
    return (a + b) % this.p;
  }
  sub(a: number, b: number): number {
    return (a - b + this.p) % this.p;
  }
  neg(a: number): number {
    return (this.p - (a % this.p)) % this.p;
  }
  mul(a: number, b: number): number {
    return (a * b) % this.p;
  }

  inv(a: number): number {
    const x = ((a % this.p) + this.p) % this.p;
    if (x === 0) {
      throw new DomainError('DIVISION_BY_ZERO', '在 F_p 中对零求逆');
    }
    // 扩展欧几里得求模逆（p 素数，非零元必有逆）。
    let [oldR, r] = [x, this.p];
    let [oldS, s] = [1, 0];
    while (r !== 0) {
      const q = Math.floor(oldR / r);
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }
    return ((oldS % this.p) + this.p) % this.p;
  }

  div(a: number, b: number): number {
    return this.mul(a, this.inv(b));
  }

  mod(a: number): number {
    return ((a % this.p) + this.p) % this.p;
  }

  pow(base: number, exp: number): number {
    let result = 1;
    let b = this.mod(base);
    let e = exp;
    while (e > 0) {
      if (e & 1) result = this.mul(result, b);
      b = this.mul(b, b);
      e = Math.floor(e / 2);
    }
    return result;
  }
}
