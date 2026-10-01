import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ALGORITHM_VERSION } from './config.js';
import { canonicalJson, FactorizationReport } from './report.js';

export class ReportStore {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_parameters (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        supported_primes TEXT NOT NULL,
        max_degree INTEGER NOT NULL,
        algorithm_version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS polynomials (
        id TEXT PRIMARY KEY,
        prime TEXT NOT NULL,
        input_coefficients TEXT NOT NULL,
        canonical_coefficients TEXT NOT NULL,
        input_kind TEXT NOT NULL,
        degree INTEGER,
        leading_coefficient TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS factorization_reports (
        id TEXT PRIMARY KEY,
        polynomial_id TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        completed INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        report_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (polynomial_id) REFERENCES polynomials(id)
      );
      CREATE TABLE IF NOT EXISTS verification_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id TEXT,
        valid INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.prepare(`INSERT OR IGNORE INTO domain_parameters(id, supported_primes, max_degree, algorithm_version)
      VALUES (1, ?, ?, ?)`).run(JSON.stringify(['2', '3', '5', '7', '11', '13']), 12, ALGORITHM_VERSION);
  }
  save(report: FactorizationReport): void {
    const hash = this.hash(report);
    const tx = this.db.prepare(`INSERT INTO polynomials(id, prime, input_coefficients, canonical_coefficients, input_kind, degree, leading_coefficient, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`);
    this.db.prepare(`INSERT INTO factorization_reports(id, polynomial_id, algorithm_version, completed, report_json, report_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`);
    this.db.exec('BEGIN');
    try {
      tx.run(report.id, report.prime, JSON.stringify(report.inputCoefficients), JSON.stringify(report.canonicalCoefficients), report.inputKind, report.degree, report.leadingCoefficient, report.createdAt);
      this.db.prepare(`INSERT INTO factorization_reports(id, polynomial_id, algorithm_version, completed, report_json, report_sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(report.id, report.id, report.algorithmVersion, report.completed ? 1 : 0, JSON.stringify(report), hash, report.createdAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: string): FactorizationReport | null {
    const row = this.db.prepare('SELECT report_json FROM factorization_reports WHERE id = ?').get(id) as { report_json?: string } | undefined;
    return row?.report_json ? JSON.parse(row.report_json) : null;
  }
  list(): Array<{ id: string; prime: string; canonicalCoefficients: string[]; createdAt: string }> {
    const rows = this.db.prepare('SELECT id, prime, canonical_coefficients, created_at FROM polynomials ORDER BY created_at DESC, id DESC').all() as Array<{ id: string; prime: string; canonical_coefficients: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, prime: row.prime, canonicalCoefficients: JSON.parse(row.canonical_coefficients), createdAt: row.created_at }));
  }
  logVerification(reportId: string | null, valid: boolean, result: unknown): void {
    this.db.prepare('INSERT INTO verification_events(report_id, valid, result_json, created_at) VALUES (?, ?, ?, ?)')
      .run(reportId, valid ? 1 : 0, JSON.stringify(result), new Date().toISOString());
  }
  close(): void { this.db.close(); }
  private hash(report: FactorizationReport): string {
    return createHashLocal(canonicalJson(report));
  }
}
function createHashLocal(text: string): string { return createHash('sha256').update(text).digest('hex'); }
