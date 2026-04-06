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
    return this.config.method as string;
  }

  get path(): string {
    return this.config.path;
  }

  /**
   * Execute the request and return the parsed body.
   *
   * @param strict - If true, throws FailedCallException on non-2xx (with deserialized error attached). Default: false.
   * @param printBody - If true, logs the response body. Default: false.
   * @param errorModels - Constructor functions to try deserializing the error body.
   * @returns The parsed response body, or deserialized error in lenient mode, or null.
   */
  async perform(strict = false, printBody = false, ...errorModels: Array<new () => unknown>): Promise<T | null> {
    const response = await this.client.execute<T>(this.config);

    if (printBody && response.rawBody) {
      log.info('Response body: %s', response.rawBody);
    }

    if (response.isSuccessful()) {
      return response.body;
    }

    // Deserialize error body if models provided
    const deserializedError = deserializeError(response.rawBody, errorModels);

    // Strict mode — throw with deserialized error attached
    if (strict) {
      throw new FailedCallException(
        `${this.config.method} ${this.config.path} failed with ${response.status} ${response.statusText}`,
        response.status,
        response.rawBody,
        this.config.path,
        deserializedError,
      );
    }

    // Lenient mode — return deserialized error or null
    return (deserializedError as T | null) ?? null;
  }

  /**
   * Execute and return the full ApiResponse wrapper.
   *
   * @param strict - If true, throws FailedCallException on non-2xx (with deserialized error attached). Default: false.
   * @param printBody - If true, logs the response body. Default: false.
   * @param errorModels - Constructor functions to try deserializing the error body.
   */
  async getResponse(strict = false, printBody = false, ...errorModels: Array<new () => unknown>): Promise<ApiResponse<T>> {
    const response = await this.client.execute<T>(this.config);

    if (printBody && response.rawBody) {
      log.info('Response body: %s', response.rawBody);
    }

    if (!response.isSuccessful() && strict) {
      const deserializedError = deserializeError(response.rawBody, errorModels);
      throw new FailedCallException(
        `${this.config.method} ${this.config.path} failed with ${response.status} ${response.statusText}`,
        response.status,
        response.rawBody,
        this.config.path,
        deserializedError,
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
    let lastResponse: ApiResponse<T> | null = null;

    while (Date.now() < deadline) {
      lastResponse = await this.client.execute<T>(this.config);

      if (lastResponse.status === expectedCode) {
        log.success('Response code matched: %d', expectedCode);
        return lastResponse;
      }

      log.info('Waiting for %d, got %d — retrying in %dms', expectedCode, lastResponse.status, interval);
      await sleep(interval);
    }

    throw new WasapiException(
      `Timed out after ${timeout}ms waiting for response code ${expectedCode} on ${this.config.method} ${this.config.path}`,
      lastResponse,
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
    let lastResponse: ApiResponse<T> | null = null;

    while (Date.now() < deadline) {
      lastResponse = await this.client.execute<T>(this.config);

      if (lastResponse.body !== null) {
        const actual = getNestedField(lastResponse.body, fieldPath);
        if (String(actual) === String(expectedValue)) {
          log.success('Field "%s" matched: %s', fieldPath, expectedValue);
          return lastResponse.body;
        }
        log.info('Field "%s" = %s, expected %s — retrying in %dms', fieldPath, actual, expectedValue, interval);
      }

      await sleep(interval);
    }

    throw new WasapiException(
      `Timed out after ${timeout}ms waiting for field "${fieldPath}" to equal "${expectedValue}" on ${this.config.method} ${this.config.path}`,
      lastResponse,
    );
  }
}

function deserializeError(rawBody: string, errorModels: Array<new () => unknown>): unknown | null {
  if (errorModels.length === 0 || !rawBody) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    log.warn('Failed to parse error body as JSON');
    return null;
  }

  const parsedKeys = new Set(Object.keys(parsed));

  for (const Model of errorModels) {
    try {
      const instance = new Model() as object;
      const modelKeys = Object.keys(instance);
      // If model has defined keys, check at least one matches the parsed response
      if (modelKeys.length > 0 && !modelKeys.some(k => parsedKeys.has(k))) {
        continue;
      }
      return Object.assign(instance, parsed);
    } catch {
      log.warn('Failed to instantiate error model %s', Model.name || 'anonymous');
      continue;
    }
  }
  return null;
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
