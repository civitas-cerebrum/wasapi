import type { WasapiClient } from '../client/WasapiClient';
import { RequestConfig } from './types';
import { ApiResponse } from './ApiResponse';
import { ResponsePair } from '../collections/ResponsePair';
import { FailedCallException } from '../exceptions/FailedCallException';
import { WasapiException } from '../exceptions/WasapiException';
import { log } from '../logger/Logger';

export class ApiCall<T> {
  private readonly client: WasapiClient;
  private readonly config: RequestConfig;

  constructor(client: WasapiClient, config: RequestConfig) {
    this.client = client;
    this.config = { ...config };
  }

  /** Create an independent copy of this call for retry/polling. */
  clone(): ApiCall<T> {
    return new ApiCall<T>(this.client, { ...this.config });
  }

  get method(): string {
    return typeof this.config.method === 'string'
      ? this.config.method
      : this.config.method;
  }

  get path(): string {
    return this.config.path;
  }

  /**
   * Execute the request and return the parsed body.
   *
   * @param strict - If true, throws FailedCallException on non-2xx. Default: false.
   * @param printBody - If true, logs the response body. Default: false.
   * @param errorModels - Constructor functions to try deserializing the error body.
   * @returns The parsed response body, or null in lenient mode on failure.
   */
  async perform(strict = false, printBody = false, ...errorModels: Array<new () => unknown>): Promise<T | null> {
    const response = await this.client.execute<T>(this.config);

    if (printBody && response.rawBody) {
      log.info('Response body: %s', response.rawBody);
    }

    if (response.isSuccessful()) {
      return response.body;
    }

    // Failed response
    if (strict) {
      throw new FailedCallException(
        `${this.config.method} ${this.config.path} failed with ${response.status} ${response.statusText}`,
        response.status,
        response.rawBody,
        this.config.path,
      );
    }

    // Lenient mode — try to deserialize error body
    if (errorModels.length > 0 && response.rawBody) {
      for (const Model of errorModels) {
        try {
          const parsed = JSON.parse(response.rawBody) as Record<string, unknown>;
          return Object.assign(new Model() as object, parsed) as T | null;
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Execute and return the full ApiResponse wrapper.
   */
  async getResponse(strict = false, printBody = false): Promise<ApiResponse<T>> {
    const response = await this.client.execute<T>(this.config);

    if (printBody && response.rawBody) {
      log.info('Response body: %s', response.rawBody);
    }

    if (!response.isSuccessful() && strict) {
      throw new FailedCallException(
        `${this.config.method} ${this.config.path} failed with ${response.status} ${response.statusText}`,
        response.status,
        response.rawBody,
        this.config.path,
      );
    }

    return response;
  }

  /**
   * Execute and return a ResponsePair with typed error deserialization.
   */
  async getResponsePair<E extends object>(ErrorClass: new () => E): Promise<ResponsePair<ApiResponse<T>, E | null>> {
    const response = await this.client.execute<T>(this.config);

    if (response.isSuccessful()) {
      return new ResponsePair(response, null);
    }

    const errorBody = response.errorBody<E>(ErrorClass);
    return new ResponsePair(response, errorBody);
  }

  /**
   * Poll until the response returns the expected HTTP status code.
   *
   * @param expectedCode - The HTTP status code to wait for.
   * @param timeout - Maximum time to wait in milliseconds.
   * @param interval - Polling interval in milliseconds. Default: 1000.
   */
  async monitorResponseCode(
    expectedCode: number,
    timeout: number,
    interval = 1000,
  ): Promise<ApiResponse<T>> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const response = await this.clone().client.execute<T>(this.config);

      if (response.status === expectedCode) {
        log.success('Response code matched: %d', expectedCode);
        return response;
      }

      log.info('Waiting for %d, got %d — retrying in %dms', expectedCode, response.status, interval);
      await sleep(interval);
    }

    throw new WasapiException(
      `Timed out after ${timeout}ms waiting for response code ${expectedCode} on ${this.config.method} ${this.config.path}`,
    );
  }

  /**
   * Poll until a field in the response body matches the expected value.
   *
   * @param fieldPath - Dot-notation path to the field (e.g., 'status' or 'data.state').
   * @param expectedValue - The value to match against (compared via string coercion).
   * @param timeout - Maximum time to wait in milliseconds.
   * @param interval - Polling interval in milliseconds. Default: 1000.
   */
  async monitorFieldValue(
    fieldPath: string,
    expectedValue: unknown,
    timeout: number,
    interval = 1000,
  ): Promise<T> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const response = await this.clone().client.execute<T>(this.config);

      if (response.body !== null) {
        const actual = getNestedField(response.body, fieldPath);
        if (String(actual) === String(expectedValue)) {
          log.success('Field "%s" matched: %s', fieldPath, expectedValue);
          return response.body;
        }
        log.info('Field "%s" = %s, expected %s — retrying in %dms', fieldPath, actual, expectedValue, interval);
      }

      await sleep(interval);
    }

    throw new WasapiException(
      `Timed out after ${timeout}ms waiting for field "${fieldPath}" to equal "${expectedValue}" on ${this.config.method} ${this.config.path}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNestedField(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
