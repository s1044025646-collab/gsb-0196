import { FiniteField } from './finiteField';
import {
  Poly,
  degree,
  derivative,
  divmod,
  gcd,
  isZero,
  monic,
  pthRoot,
} from './polynomial';

export interface SquareFreeFactor {
  factor: Poly;
  multiplicity: number;
}

/**
 * 平方自由分解（含正特征情形）。
 * f 需为首一多项式。返回各平方自由因子及其重数，乘积恰为 f。
 *
 * 关键：若导数恒为零，则 f = g^p，必须抽取 p 次根并把重数乘以 p，
 * 绝不能因导数为零就断言“无重根”。
 */
export function squareFreeFactorization(field: FiniteField, fInput: Poly): SquareFreeFactor[] {
  const result: SquareFreeFactor[] = [];

  // mult 是外部分配的重数倍乘（p 次根传播时为 p 的倍数）。
  const walk = (fInput2: Poly, mult: number): void => {
    let f = monic(field, fInput2);
    if (isZero(f) || degree(f) === 0) return;

    // 顶部：若整体为 p 次幂（导数恒为零），抽根并传播重数。
    let fp = derivative(field, f);
    while (isZero(fp) && degree(f) > 0) {
      const root = pthRoot(field, f, field.p);
      if (root === null) break;
      f = monic(field, root);
      mult *= field.p;
      fp = derivative(field, f);
    }

    let c = gcd(field, f, fp);
    let w = divmod(field, f, c).q; // 平方自由部分
    let k = 1;

    while (degree(w) > 0) {
      const gNext = gcd(field, w, c);
      const factor = divmod(field, w, gNext).q; // 重数恰为 k 的不可约因子之积
      if (degree(factor) > 0) {
        result.push({ factor: monic(field, factor), multiplicity: mult * k });
      }
      w = gNext;
      c = divmod(field, c, gNext).q;
      k++;
    }

    // c 中剩余的不可分因子（导数为零）继续抽 p 次根传播重数。
    if (degree(c) > 0) {
      const root = pthRoot(field, c, field.p);
      if (root !== null && degree(root) > 0) {
        walk(root, mult * field.p);
      } else if (degree(c) > 0) {
        result.push({ factor: monic(field, c), multiplicity: mult });
      }
    }
  };

  walk(monic(field, fInput), 1);
  result.sort((a, b) => a.multiplicity - b.multiplicity || degree(a.factor) - degree(b.factor));
  return dedupe(result);
}

function dedupe(factors: SquareFreeFactor[]): SquareFreeFactor[] {
  const map = new Map<string, SquareFreeFactor>();
  for (const item of factors) {
    const key = JSON.stringify(item.factor);
    const existing = map.get(key);
    if (existing) existing.multiplicity += item.multiplicity;
    else map.set(key, { factor: item.factor, multiplicity: item.multiplicity });
  }
  return [...map.values()];
}
