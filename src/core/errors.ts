/** 领域内可区分的错误类型，便于 API/CLI 给出明确语义。 */
export type ErrorCode =
  | 'COMPOSITE_MODULUS'
  | 'MODULUS_NOT_SUPPORTED'
  | 'DIVISION_BY_ZERO'
  | 'ILLEGAL_DEGREE'
  | 'ZERO_POLYNOMIAL'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_COEFFICIENT'
  | 'INVALID_CERTIFICATE'
  | 'NOT_FOUND'
  | 'INVALID_INPUT';

export class DomainError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
