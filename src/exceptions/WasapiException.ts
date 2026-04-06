export class WasapiException extends Error {
  readonly lastResponse: unknown;

  constructor(message: string, lastResponse?: unknown) {
    super(message);
    this.name = 'WasapiException';
    this.lastResponse = lastResponse ?? null;
  }
}
