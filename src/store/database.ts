import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FactorizationReport, PolynomialRecord } from './schema';

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS polynomials (
        id TEXT PRIMARY KEY,
        p INTEGER NOT NULL,
        coeffs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS field_params (
        p INTEGER PRIMARY KEY,
        description TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS algorithm_versions (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        polynomial_id TEXT NOT NULL,
        p INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        complete INTEGER NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  upsertField(p: number, description: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO field_params(p, description) VALUES (?, ?)')
      .run(p, description);
  }

  upsertAlgorithm(version: string, description: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO algorithm_versions(version, description, created_at) VALUES (?, ?, ?)',
      )
      .run(version, description, new Date().toISOString());
  }

  insertPolynomial(rec: PolynomialRecord): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO polynomials(id, p, coeffs_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(rec.id, rec.p, JSON.stringify(rec.coeffs), rec.created_at);
  }

  saveReport(report: FactorizationReport, polynomialId: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO reports
         (id, polynomial_id, p, payload_json, complete, algorithm_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id,
        polynomialId,
        report.p,
        JSON.stringify(report),
        report.complete ? 1 : 0,
        report.algorithm_version,
        report.created_at,
      );
  }

  getReport(id: string): FactorizationReport | null {
    const row = this.db.prepare('SELECT payload_json FROM reports WHERE id = ?').get(id) as
      | { payload_json: string }
      | undefined;
    return row ? (JSON.parse(row.payload_json) as FactorizationReport) : null;
  }

  listReports(): { id: string; p: number; complete: boolean; created_at: string }[] {
    const rows = this.db
      .prepare('SELECT id, p, complete, created_at FROM reports ORDER BY created_at DESC')
      .all() as { id: string; p: number; complete: number; created_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      p: r.p,
      complete: r.complete === 1,
      created_at: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
