export class WasapiException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasapiException';
  }
}
