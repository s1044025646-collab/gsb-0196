import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FiniteField } from '../src/core/finiteField';
import { canonicalize } from '../src/core/polynomial';
import { verifyReport } from '../src/core/verify';
import { Store } from '../src/store/database';
import { buildAndStoreReport } from '../src/service/factorService';

function tempDb(): { dir: string; store: Store } {
  const base = join(process.cwd(), 'data');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'test-'));
  return { dir, store: new Store(join(dir, 'test.sqlite')) };
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Windows 下 WAL 句柄可能延迟释放；忽略清理错误，不影响断言。
  }
}

test('合法报告通过独立核验（逐因子 Rabin + 乘积重建）', () => {
  const { dir, store } = tempDb();
  try {
    const out = buildAndStoreReport(store, { p: 5, coeffs: [0, 1, 1, 1] });
    const v = verifyReport(out.report!);
    assert.equal(v.valid, true, JSON.stringify(v.issues));
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('乘积正确但含可约因子的伪造证书必须被拒绝', () => {
  const { dir, store } = tempDb();
  try {
    const out = buildAndStoreReport(store, { p: 3, coeffs: [1, 0, 1] });
    const report = JSON.parse(JSON.stringify(out.report!));
    // 用 x^2 替换不可约的 x^2+1，并把原多项式改成 x^2，使乘积仍然成立。
    report.factors = [
      {
        factor_coeffs: ['0', '0', '1'], // x^2 = x*x 可约
        multiplicity: 1,
        degree: 2,
        certificate: report.factors[0].certificate,
      },
    ];
    report.original_coeffs = ['0', '0', '1'];
    report.canonical_coeffs = ['0', '0', '1'];
    const v = verifyReport(report);
    assert.equal(v.valid, false);
    assert.ok(v.issues.some((i) => i.code === 'REDUCIBLE_FACTOR'));
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('乘积重建不一致被拒绝（篡改重数）', () => {
  const { dir, store } = tempDb();
  try {
    const out = buildAndStoreReport(store, { p: 2, coeffs: [1, 0, 1] });
    const report = JSON.parse(JSON.stringify(out.report!));
    report.factors[0].multiplicity = 3; // 实际为 2
    const v = verifyReport(report);
    assert.equal(v.valid, false);
    assert.ok(v.issues.some((i) => i.code === 'PRODUCT_MISMATCH'));
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('非素模数与零多项式语义明确', () => {
  const { dir, store } = tempDb();
  try {
    assert.throws(() => buildAndStoreReport(store, { p: 9, coeffs: [1, 2] }), /素数|合数/);
    const zero = buildAndStoreReport(store, { p: 3, coeffs: [0, 0] });
    assert.equal(zero.kind, 'ZERO');
    const constant = buildAndStoreReport(store, { p: 3, coeffs: [2] });
    assert.equal(constant.kind, 'CONSTANT');
    assert.equal(constant.leading_coefficient, '2');
  } finally {
    store.close();
    cleanup(dir);
  }
});

test('旧报告在重新打开数据库后仍可独立复核', () => {
  const { dir } = tempDb();
  const dbPath = join(dir, 'persist.sqlite');
  let id: string;
  {
    const store = new Store(dbPath);
    const out = buildAndStoreReport(store, { p: 7, coeffs: [6, 0, 0, 0, 0, 0, 1] });
    id = out.report!.id;
    store.close();
  }
  {
    const store = new Store(dbPath);
    const report = store.getReport(id!)!;
    const v = verifyReport(report);
    assert.equal(v.valid, true);
    store.close();
  }
  cleanup(dir);
});

test('大整数系数经字符串传输与约简', () => {
  const field = new FiniteField(7);
  const poly = canonicalize(field, ['8', '14', '1']); // -> [1,0,1]
  assert.deepEqual(poly, [1, 0, 1]);
});
