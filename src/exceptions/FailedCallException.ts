import { WasapiException } from './WasapiException';

export class FailedCallException extends WasapiException {
  readonly statusCode: number;
  readonly responseBody: string;
  readonly url: string;
  readonly errorBody: unknown;

  constructor(message: string, statusCode: number, responseBody: string, url: string, errorBody?: unknown) {
    super(message);
    this.name = 'FailedCallException';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
    this.errorBody = errorBody ?? null;
  }
}
