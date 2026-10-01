export class DomainError extends Error {
  constructor(
    public code: 'COMPOSITE_MODULUS' | 'ZERO_DIVISOR' | 'INVALID_DEGREE' | 'BUDGET_EXCEEDED' | 'INVALID_INPUT',
    message: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
