import { FiniteField } from './finiteField';
import {
  Poly,
  gcd,
  isZero,
  degree,
  monic,
  sub,
  powMod,
} from './polynomial';

export interface GcdEvidence {
  exponent: number; // i
  gcd_degree: number; // deg gcd(f, x^{p^i} - x mod f)
}

export interface RabinCertificate {
  algorithm: 'RABIN_IRREDUCIBILITY_Fp';
  p: number;
  factor_coeffs: string[];
  n: number;
  gcd_checks: GcdEvidence[];
  final_frobenius: { exponent: number; remainder_zero: true };
  condition_zh: string;
}

export function primeDivisors(n: number): number[] {
  const out: number[] = [];
  let x = n;
  for (let q = 2; q * q <= x; q++) {
    if (x % q === 0) {
      out.push(q);
      while (x % q === 0) x = Math.floor(x / q);
    }
  }
  if (x > 1) out.push(x);
  return out;
}

export function frobeniusXPow(field: FiniteField, prev: Poly, f: Poly): Poly {
  return powMod(field, prev, BigInt(field.p), f);
}

export function rabinTest(
  field: FiniteField,
  fInput: Poly,
  collect = false,
): { irreducible: boolean; certificate?: RabinCertificate } {
  const f = monic(field, fInput);
  const n = degree(f);
  if (n <= 0) {
    return { irreducible: false };
  }
  // 所有 1 次首一多项式均不可约；Rabin 条件对此平凡成立。
  if (n === 1) {
    if (!collect) return { irreducible: true };
    const certificate: RabinCertificate = {
      algorithm: 'RABIN_IRREDUCIBILITY_Fp',
      p: field.p,
      factor_coeffs: f.map((c) => c.toString()),
      n: 1,
      gcd_checks: [],
      final_frobenius: { exponent: 1, remainder_zero: true },
      condition_zh:
        '次数为 1 的首一多项式在任何域上都不可约（线性多项式无真因子）；' +
        'Rabin 条件在此平凡成立：x^p ≡ x (mod 任意一次因子)。',
    };
    return { irreducible: true, certificate };
  }

  const cache = new Map<number, Poly>();
  let cur: Poly = [0, 1]; // x mod f
  for (let i = 1; i <= n; i++) {
    cur = frobeniusXPow(field, cur, f);
    cache.set(i, cur);
  }

  const checks: GcdEvidence[] = [];
  const qs = primeDivisors(n);
  for (const q of qs) {
    const i = n / q;
    const xpi = cache.get(i)!;
    const g = gcd(field, f, sub(field, xpi, [0, 1]));
    const d = degree(g);
    if (collect) checks.push({ exponent: i, gcd_degree: d });
    if (d !== 0) return { irreducible: false };
  }

  const xpn = cache.get(n)!;
  const remainder = sub(field, xpn, [0, 1]);
  if (!isZero(remainder)) return { irreducible: false };

  const certificate: RabinCertificate = {
    algorithm: 'RABIN_IRREDUCIBILITY_Fp',
    p: field.p,
    factor_coeffs: f.map((c) => c.toString()),
    n,
    gcd_checks: checks,
    final_frobenius: { exponent: n, remainder_zero: true },
    condition_zh:
      'Rabin 判据：设 f 为 F_p 上首一 n 次多项式。f 不可约 当且仅当 ' +
      '(1) 对 n 的每个素除子 q，gcd(f, x^(p^(n/q)) − x) = 1；' +
      '(2) x^(p^n) ≡ x (mod f)，即 x^(p^n) − x 除以 f 的余式为零。',
  };
  return { irreducible: true, certificate };
}

export function isIrreducible(field: FiniteField, f: Poly): boolean {
  return rabinTest(field, f).irreducible;
}
