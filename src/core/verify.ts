import { FiniteField, validatePrime } from './finiteField';
import {
  Poly,
  canonicalize,
  compareFactor,
  degree,
  gcd,
  isZero,
  monic,
  mul,
  power,
  scalarMul,
  sub,
} from './polynomial';
import { rabinTest } from './irreducible';
import { FactorizationReport } from '../store/schema';

export interface VerificationIssue {
  code: string;
  message: string;
}

export interface VerificationResult {
  valid: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  issues: VerificationIssue[];
}

/**
 * 独立核验：不读取报告里自报的 gcd_degree/remainder_zero 结论，
 * 而是从 p、原始系数与声称的首一因子重新执行所有运算。
 */
export function verifyReport(report: FactorizationReport): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  const issues: VerificationIssue[] = [];
  const fail = (name: string, code: string, message: string) => {
    checks.push({ name, passed: false, detail: message });
    issues.push({ code, message });
  };
  const pass = (name: string, detail: string) => checks.push({ name, passed: true, detail });

  let field: FiniteField | undefined;
  try {
    validatePrime(report.p);
    field = new FiniteField(report.p);
    pass('域参数', `p=${report.p} 为受支持素数`);
  } catch (e) {
    fail('域参数', 'INVALID_FIELD', (e as Error).message);
    return { valid: false, checks, issues };
  }

  // 原多项式规范化。
  let original: Poly;
  try {
    original = canonicalize(field, report.original_coeffs);
    pass('系数规范化', `升幂系数=${JSON.stringify(original)}`);
  } catch (e) {
    fail('系数规范化', 'INVALID_COEFFICIENT', (e as Error).message);
    return { valid: false, checks, issues };
  }

  if (isZero(original)) {
    fail('原多项式', 'ZERO_POLYNOMIAL', '零多项式不参与分解证书');
    return { valid: false, checks, issues };
  }
  if (degree(original) === 0) {
    fail('原多项式', 'CONSTANT_POLYNOMIAL', '非零常数没有因子分解');
    return { valid: false, checks, issues };
  }

  const lc = original[original.length - 1];
  const targetMonic = scalarMul(field, original, field.inv(lc));

  if (report.factors.length === 0) {
    fail('因子列表', 'NO_FACTORS', '至少需要一个非常数因子');
  }

  // 去重检查与逐因子独立不可约判定。
  const seen = new Set<string>();
  let reconstructedMonic: Poly = [1];

  for (let idx = 0; idx < report.factors.length; idx++) {
    const claimed = report.factors[idx];
    let fac: Poly;
    try {
      fac = canonicalize(field, claimed.factor_coeffs);
    } catch (e) {
      fail(`因子#${idx} 系数`, 'INVALID_COEFFICIENT', (e as Error).message);
      continue;
    }
    if (isZero(fac) || degree(fac) <= 0) {
      fail(`因子#${idx} 次数`, 'ILLEGAL_DEGREE', '不可约因子必须为非常数');
      continue;
    }
    fac = monic(field, fac);
    const key = JSON.stringify(fac);
    if (seen.has(key)) {
      fail(`因子#${idx} 唯一`, 'DUPLICATE_FACTOR', '相同首一因子应合并为一条重数记录');
    }
    seen.add(key);

    // 独立重算 Rabin，不信任报告证书结论。
    const test = rabinTest(field, fac, false);
    if (!test.irreducible) {
      fail(
        `因子#${idx} 不可约性`,
        'REDUCIBLE_FACTOR',
        `因子 ${JSON.stringify(fac)} 未通过独立 Rabin 判定，属于可约因子`,
      );
      continue;
    }
    pass(`因子#${idx} 不可约性`, `${JSON.stringify(fac)} 通过 Rabin，次数 ${degree(fac)}`);

    const mult = Number(claimed.multiplicity);
    if (!Number.isInteger(mult) || mult <= 0) {
      fail(`因子#${idx} 重数`, 'INVALID_MULTIPLICITY', `重数非法: ${String(claimed.multiplicity)}`);
      continue;
    }
    reconstructedMonic = mul(field, reconstructedMonic, power(field, fac, mult));
  }

  // 互异因子两两 GCD=1（平方自由合并后的要求）。
  const monicFactors = report.factors
    .map((f) => monic(field, canonicalize(field, f.factor_coeffs)))
    .filter((f) => degree(f) > 0)
    .sort(compareFactor);
  for (let i = 0; i < monicFactors.length; i++) {
    for (let j = i + 1; j < monicFactors.length; j++) {
      const g = gcd(field, monicFactors[i], monicFactors[j]);
      if (degree(g) > 0) {
        fail('因子互异', 'COMMON_FACTOR', `两个因子共享非常数公因式 ${JSON.stringify(g)}`);
      }
    }
  }

  // 乘积重建：lc * Π f_i^{e_i} 必须等于原多项式。
  const reconstructed = scalarMul(field, reconstructedMonic, lc);
  const rebuiltMonic = monic(field, reconstructed);
  if (
    degree(rebuiltMonic) === degree(targetMonic) &&
    isZero(sub(field, rebuiltMonic, targetMonic))
  ) {
    pass(
      '乘积重建',
      `${lc}·Π f_i^e_i 等于原多项式（首一化后逐项相等）`,
    );
  } else {
    fail(
      '乘积重建',
      'PRODUCT_MISMATCH',
      `重建结果 ${JSON.stringify(rebuiltMonic)} 与原多项式 ${JSON.stringify(targetMonic)} 不一致`,
    );
  }

  // 排序规则核验。
  const sortedOk = report.factors.every((f, i) => {
    if (i === 0) return true;
    const a = monic(field, canonicalize(field, report.factors[i - 1].factor_coeffs));
    const b = monic(field, canonicalize(field, f.factor_coeffs));
    return compareFactor(a, b) <= 0;
  });
  if (sortedOk) pass('因子排序', '满足次数升序、系数字典序规则');
  else fail('因子排序', 'UNSORTED_FACTORS', '因子未按确定规则排序');

  return { valid: issues.length === 0, checks, issues };
}
