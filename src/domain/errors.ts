/**
 * An error whose message is written for the person using the app (validation, permissions,
 * "not found"). The server returns these messages as-is; any other error is treated as an
 * internal failure and never shown.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
