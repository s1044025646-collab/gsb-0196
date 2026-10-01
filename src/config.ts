export const SUPPORTED_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n] as const;
export const MAX_POLY_DEGREE = 12;
export const MAX_EXPONENT = 64;
export const DEFAULT_BUDGET = 250_000n;
export const ALGORITHM_VERSION = 'ff-poly-factor-1.0.0-deterministic';

export type AppConfig = {
  port: number;
  dataDir: string;
  dbPath: string;
};

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 必须是 1 到 65535 之间的整数');
  }
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), 'data');
  return {
    port,
    dataDir,
    dbPath: process.env.DB_PATH ?? `${dataDir.replace(/[\\/]$/, '')}/factorization.db`
  };
}
import { resolve } from 'node:path';
