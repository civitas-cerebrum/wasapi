import { WasapiException } from './WasapiException';

export class FailedCallException extends WasapiException {
  readonly statusCode: number;
  readonly responseBody: string;
  readonly url: string;

  constructor(message: string, statusCode: number, responseBody: string, url: string) {
    super(message);
    this.name = 'FailedCallException';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
  }
}
