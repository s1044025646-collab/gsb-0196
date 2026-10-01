import { createHash, randomUUID } from 'node:crypto';
import { FiniteField } from '../core/finiteField';
import { canonicalize, degree, isZero } from '../core/polynomial';
import { factorize, ALGORITHM_VERSION, createBudget } from '../core/factorize';
import { DomainError } from '../core/errors';
import { verifyReport, VerificationResult } from '../core/verify';
import { Store } from '../store/database';
import { FactorizationReport } from '../store/schema';

export interface FactorRequest {
  p: number;
  coeffs: Array<number | string>;
}

export type InputKind = 'ZERO' | 'CONSTANT' | 'POLYNOMIAL';

export function classifyInput(req: FactorRequest): {
  field: FiniteField;
  poly: ReturnType<typeof canonicalize>;
  kind: InputKind;
} {
  const field = new FiniteField(Number(req.p));
  const poly = canonicalize(field, req.coeffs ?? []);
  let kind: InputKind;
  if (isZero(poly)) kind = 'ZERO';
  else if (degree(poly) === 0) kind = 'CONSTANT';
  else kind = 'POLYNOMIAL';
  return { field, poly, kind };
}

export function buildAndStoreReport(store: Store, req: FactorRequest): {
  report?: FactorizationReport;
  kind: InputKind;
  leading_coefficient?: string;
  message: string;
} {
  const { field, poly, kind } = classifyInput(req);
  store.upsertField(field.p, `素数有限域 F_${field.p}`);
  store.upsertAlgorithm(ALGORITHM_VERSION, 'Rabin 不可约判定 + DDF + 确定性 EDF');

  if (kind === 'ZERO') {
    return { kind, message: '零多项式：未定义首项系数与分解，仅做规范化登记。' };
  }
  if (kind === 'CONSTANT') {
    return {
      kind,
      leading_coefficient: poly.map((c) => c.toString())[0],
      message: `非零常数 ${poly[0]}：单位意义下无非常数因子，首项系数=${poly[0]}。`,
    };
  }

  const result = factorize(field, poly, createBudget());
  const now = new Date().toISOString();
  const polyId = createHash('sha256').update(`${field.p}:${JSON.stringify(result.canonical_coeffs)}`).digest('hex').slice(0, 16);

  const report: FactorizationReport = {
    id: randomUUID(),
    p: field.p,
    original_coeffs: result.original_coeffs,
    canonical_coeffs: result.canonical_coeffs,
    leading_coefficient: result.leading_coefficient,
    original_degree: degree(poly),
    factors: result.factors.map((f) => ({
      factor_coeffs: f.factor.map((c) => c.toString()),
      multiplicity: f.multiplicity,
      degree: degree(f.factor),
      certificate: {
        algorithm: f.certificate.algorithm,
        gcd_checks: f.certificate.gcd_checks,
        final_frobenius: f.certificate.final_frobenius,
        condition_zh: f.certificate.condition_zh,
      },
    })),
    complete: result.complete,
    residual_coeffs: result.residual ? result.residual.map((c) => c.toString()) : null,
    algorithm_version: result.algorithm_version,
    created_at: now,
  };

  store.insertPolynomial({ id: polyId, p: field.p, coeffs: result.canonical_coeffs, created_at: now });
  store.saveReport(report, polyId);
  return {
    report,
    kind,
    leading_coefficient: result.leading_coefficient,
    message: result.complete ? '分解完成且全部因子通过不可约证明。' : '部分分解：存在尚未拆开的余因子，未宣称其不可约。',
  };
}

export function verifyStored(store: Store, id: string): VerificationResult {
  const report = store.getReport(id);
  if (!report) throw new DomainError('NOT_FOUND', `报告不存在: ${id}`);
  return verifyReport(report);
}

export function getReport(store: Store, id: string): FactorizationReport {
  const report = store.getReport(id);
  if (!report) throw new DomainError('NOT_FOUND', `报告不存在: ${id}`);
  return report;
}
