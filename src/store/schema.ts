export interface FactorEntry {
  factor_coeffs: string[];
  multiplicity: number;
  degree: number;
  certificate: {
    algorithm: string;
    gcd_checks: { exponent: number; gcd_degree: number }[];
    final_frobenius: { exponent: number; remainder_zero: boolean };
    condition_zh: string;
  };
}

export interface FactorizationReport {
  id: string;
  p: number;
  original_coeffs: string[];
  canonical_coeffs: string[];
  leading_coefficient: string;
  original_degree: number;
  factors: FactorEntry[];
  complete: boolean;
  residual_coeffs?: string[] | null;
  algorithm_version: string;
  created_at: string;
}

export interface PolynomialRecord {
  id: string;
  p: number;
  coeffs: string[];
  created_at: string;
}
