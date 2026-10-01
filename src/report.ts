import { createHash } from 'node:crypto';
import { ALGORITHM_VERSION } from './config.js';
import { DomainError } from './errors.js';
import { Factorization, certifyIrreducible, reconstruct, sortTerms } from './factor.js';
import {
  add, assertSupportedPrime, canonicalFromText, degree, gcd, inverse, isOne, isZero,
  leadingCoefficient, mod, monic, multiply, Poly, polyToText, samePoly, trim
} from './finiteField.js';

export type FactorInput = { factor: string[]; multiplicity: string | number; certificate?: unknown };
export type FactorizationReport = {
  schema: 'finite-field-factorization/v1';
  id: string;
  algorithmVersion: string;
  prime: string;
  inputCoefficients: string[];
  canonicalCoefficients: string[];
  inputKind: 'zero' | 'nonzero_constant' | 'polynomial';
  degree: number | null;
  leadingCoefficient: string | null;
  factors: Array<{ factor: string[]; multiplicity: number; certificate: ReturnType<typeof certifyIrreducible> }>;
  budget: { spent: string; limit: string };
  completed: boolean;
  createdAt: string;
};
export type VerificationResult = {
  valid: boolean;
  errors: string[];
  checks: string[];
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)]));
  return value;
}
export function reportHash(report: FactorizationReport): string {
  return createHash('sha256').update(canonicalJson(report)).digest('hex');
}

export function buildReport(primeText: string, coefficientsText: string[], factorization: Factorization, budgetLimit: bigint): FactorizationReport {
  const prime = assertSupportedPrime(primeText);
  const poly = canonicalFromText(coefficientsText, prime);
  const factors = sortTerms(factorization.factors).map((term) => ({
    factor: polyToText(term.factor),
    multiplicity: term.multiplicity,
    certificate: factorization.certificates.find((cert) => JSON.stringify(cert.factor) === JSON.stringify(polyToText(term.factor)))!
  }));
  const base = {
    schema: 'finite-field-factorization/v1' as const,
    id: '',
    algorithmVersion: ALGORITHM_VERSION,
    prime: prime.toString(),
    inputCoefficients: coefficientsText.map(String),
    canonicalCoefficients: polyToText(poly),
    inputKind: isZero(poly) ? 'zero' as const : degree(poly) === 0 ? 'nonzero_constant' as const : 'polynomial' as const,
    degree: degree(poly) < 0 ? null : degree(poly),
    leadingCoefficient: isZero(poly) ? null : leadingCoefficient(poly).toString(),
    factors,
    budget: { spent: factorization.budgetSpent, limit: budgetLimit.toString() },
    completed: factors.length > 0 || isZero(poly) || degree(poly) === 0,
    createdAt: new Date().toISOString()
  };
  const digest = createHash('sha256').update(canonicalJson({ ...base, id: null })).digest('hex').slice(0, 16);
  return { ...base, id: digest };
}

function asTextArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new DomainError('INVALID_INPUT', `${path} 必须是数组`);
  return value.map((item) => {
    if (typeof item !== 'string' && typeof item !== 'number') throw new DomainError('INVALID_INPUT', `${path} 中所有大整数必须经字符串传输`);
    return String(item);
  });
}

export function verifyReport(input: unknown): VerificationResult {
  const errors: string[] = [];
  const checks: string[] = [];
  const fail = (message: string) => errors.push(message);;
  try {
    const report = input as Partial<FactorizationReport>;
    if (!report || report.schema !== 'finite-field-factorization/v1') return { valid: false, errors: ['报告 schema 不匹配'], checks };
    const p = assertSupportedPrime(String(report.prime));
    checks.push(`模数 ${p} 属于受支持且验证过的小素数集合`);
    const inputCoefficients = asTextArray(report.inputCoefficients, 'inputCoefficients');
    const canonical = canonicalFromText(asTextArray(report.canonicalCoefficients, 'canonicalCoefficients'), p);
    const inputCanonical = canonicalFromText(inputCoefficients, p);
    if (!samePoly(inputCanonical, canonical)) fail('canonicalCoefficients 不是输入系数的统一模约简规范表示');
    else checks.push('系数模约简、零项删除和输入重排表示一致');

    if (report.algorithmVersion !== ALGORITHM_VERSION) fail('algorithmVersion 不是当前可核验版本');
    if (report.leadingCoefficient !== (isZero(canonical) ? null : leadingCoefficient(canonical).toString())) fail('首项系数与规范多项式不一致');
    const reportedDegree = degree(canonical) < 0 ? null : degree(canonical);
    if (report.degree !== reportedDegree) fail('多项式次数不匹配');
    const expectedKind = isZero(canonical) ? 'zero' : degree(canonical) === 0 ? 'nonzero_constant' : 'polynomial';
    if (report.inputKind !== expectedKind) fail('零多项式、非零常数或多项式语义分类错误');

    const terms = Array.isArray(report.factors) ? report.factors : [];
    if (!Array.isArray(report.factors)) fail('factors 必须是数组');
    if ((expectedKind === 'zero' || expectedKind === 'nonzero_constant') && terms.length !== 0) fail('零多项式或非零常数不能给出非常数不可约因子');

    let rebuilt: Poly = [1n];
    const seen = new Set<string>();
    for (const [index, item] of terms.entries()) {
      try {
        const factor = canonicalFromText(asTextArray(item?.factor, `factors[${index}].factor`), p);
        const multiplicity = Number(item?.multiplicity);
        if (degree(factor) <= 0) fail(`factors[${index}] 不是非常数因子`);
        if (leadingCoefficient(factor) !== 1n) fail(`factors[${index}] 不是首一因子`);
        if (!Number.isInteger(multiplicity) || multiplicity < 1) fail(`factors[${index}] 重数必须是正整数`);
        const key = JSON.stringify(polyToText(factor));
        if (seen.has(key)) fail(`factors[${index}] 重复出现，应合并重数`);
        seen.add(key);
        try {
          const cert = certifyIrreducible(factor, p);
          const supplied = item?.certificate;
          if (!supplied || canonicalJson(supplied) !== canonicalJson(cert)) fail(`factors[${index}] 的不可约证书未通过独立 Frobenius/GCD 重算`);
          else checks.push(`因子 ${key} 的逐项 Frobenius 模幂与 GCD 条件通过`);
        } catch (error) {
          fail(`factors[${index}] 声称不可约但独立检查拒绝：${(error as Error).message}`);
        }
        for (let k = 0; k < multiplicity; k++) rebuilt = multiply(rebuilt, factor, p);
      } catch (error) {
        fail(`factors[${index}] 格式无效：${(error as Error).message}`);
      }
    }
    if (!isZero(canonical) && degree(canonical) > 0) {
      const lead = leadingCoefficient(canonical);
      const expected = multiply([lead], monic(canonical, p), p);
      if (!samePoly(rebuilt, monic(canonical, p))) fail('首一因子按重数重建后不等于原多项式的首一化');
      else checks.push('重建乘积等于原多项式；非一首项系数由 leadingCoefficient 单独保留');
      void expected; void inverse; void add; void gcd; void mod;
    } else if (isZero(canonical)) {
      checks.push('零多项式按语义不分解为不可约因子');
    } else {
      checks.push('非零常数按语义不分解为不可约因子，其值为首项系数');
    }
  } catch (error) {
    fail((error as Error).message);
  }
  return { valid: errors.length === 0, errors, checks };
}
