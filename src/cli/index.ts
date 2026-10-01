#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../store/database';
import {
  buildAndStoreReport,
  getReport,
  verifyStored,
} from '../service/factorService';
import { verifyReport } from '../core/verify';
import { FactorizationReport } from '../store/schema';
import { DomainError } from '../core/errors';
import { startServer } from '../api/server';

const DATA_DIR = process.env.GF_DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'gfpoly.sqlite');

function store(): Store {
  return new Store(DB_PATH);
}

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function parseCoeffs(argv: string[]): { p: number; coeffs: string[] } {
  const p = Number(argv[0]);
  if (Number.isNaN(p)) throw new DomainError('INVALID_INPUT', '用法: <p> <c0,c1,...>');
  const coeffs = argv[1].split(',').map((s) => s.trim());
  return { p, coeffs };
}

function runDemo(db: Store): void {
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    process.stdout.write(s + '\n');
  };

  log('=== 演示 1：不可约二次（F_3 上 x^2+1） ===');
  const r1 = buildAndStoreReport(db, { p: 3, coeffs: [1, 0, 1] });
  log(`报告ID ${r1.report!.id}，complete=${r1.report!.complete}`);
  for (const f of r1.report!.factors) {
    log(`  不可约因子 ${JSON.stringify(f.factor_coeffs)} 重数 ${f.multiplicity}`);
    log(`  证据: ${f.certificate.condition_zh}`);
  }
  const v1 = verifyStored(db, r1.report!.id);
  log(`独立核验 valid=${v1.valid}`);

  log('\n=== 演示 2：小特征 p=2 导数恒为零（(x+1)^2 = x^2+1） ===');
  const r2 = buildAndStoreReport(db, { p: 2, coeffs: [1, 0, 1] });
  log(`因子 ${JSON.stringify(r2.report!.factors[0].factor_coeffs)} 重数 ${r2.report!.factors[0].multiplicity}`);
  const v2 = verifyStored(db, r2.report!.id);
  log(`独立核验 valid=${v2.valid}`);

  log('\n=== 演示 3：篡改证书（把不可约二次换成可约 x^2，并伪标证明） ===');
  const tampered: FactorizationReport = JSON.parse(JSON.stringify(r1.report!));
  tampered.id = 'tampered-demo';
  tampered.factors[0].factor_coeffs = ['0', '0', '1']; // x^2 在 F_3 上可约
  tampered.factors[0].degree = 2;
  const v3 = verifyReport(tampered);
  log(`篡改后核验 valid=${v3.valid}`);
  for (const issue of v3.issues) log(`  拒绝原因 [${issue.code}] ${issue.message}`);

  const demoPath = join(DATA_DIR, 'demo-output.txt');
  writeFileSync(demoPath, lines.join('\n'), 'utf8');
  log(`\n演示输出已导出: ${demoPath}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  mkdirSync(DATA_DIR, { recursive: true });

  switch (cmd) {
    case 'serve': {
      const port = Number(process.env.PORT ?? rest[0] ?? 8787);
      const db = store();
      await startServer(db, port);
      process.stdout.write(`HTTP API 已启动: http://localhost:${port} (数据目录 ${DATA_DIR})\n`);
      break;
    }
    case 'factor': {
      const { p, coeffs } = parseCoeffs(rest);
      const db = store();
      print(buildAndStoreReport(db, { p, coeffs }));
      db.close();
      break;
    }
    case 'verify': {
      const db = store();
      print({ report_id: rest[0], verification: verifyStored(db, rest[0]) });
      db.close();
      break;
    }
    case 'get': {
      const db = store();
      print(getReport(db, rest[0]));
      db.close();
      break;
    }
    case 'list': {
      const db = store();
      print({ reports: db.listReports() });
      db.close();
      break;
    }
    case 'export': {
      const db = store();
      const report = getReport(db, rest[0]);
      const outPath = join(DATA_DIR, `report-${rest[0]}.json`);
      writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      process.stdout.write(`已导出报告到 ${outPath}\n`);
      db.close();
      break;
    }
    case 'demo': {
      const db = store();
      runDemo(db);
      db.close();
      break;
    }
    default:
      process.stdout.write(
        [
          '用法: gfpoly <command> [参数]',
          '命令:',
          '  serve [port]                 启动 HTTP API（PORT 环境变量可覆盖）',
          '  factor <p> <c0,c1,...>       导入并分解，生成可核验报告',
          '  verify <report-id>           独立核验已存报告',
          '  get <report-id>              查看报告',
          '  list                         列出全部报告',
          '  export <report-id>           导出报告 JSON 到 data 目录',
          '  demo                         完整分解/逐因子证明/篡改失败演示',
          '',
        ].join('\n'),
      );
  }
}

main().catch((e) => {
  if (e instanceof DomainError) {
    process.stderr.write(`错误 [${e.code}] ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
