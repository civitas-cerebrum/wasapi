import { ContextStore } from '@civitas-cerebrum/context-store';
import { CallOptions, ClientConfig, HttpMethod, RequestConfig } from '../models/types';
import { ApiResponse } from '../models/ApiResponse';
import { ApiCall } from '../models/ApiCall';
import { WasapiException } from '../exceptions/WasapiException';
import { httpMetadata } from '../decorators/http';
import { createLogger } from '../logger/Logger';
import * as fs from 'fs';
import * as path from 'path';

const BODY_METHODS = new Set([HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH]);

export class WasapiClient {
  readonly config: ClientConfig;

  private constructor(config: ClientConfig) {
    this.config = config;
  }

  async execute<T>(requestConfig: RequestConfig): Promise<ApiResponse<T>> {
    const url = this.buildUrl(requestConfig);
    const headers = { ...this.config.headers, ...requestConfig.headers };
    const reqLog = createLogger('request');
    const resLog = createLogger('response');

    // Build fetch options
    const init: RequestInit = {
      method: requestConfig.method as string,
      headers,
      redirect: this.config.followRedirects ? 'follow' : 'manual',
    };

    // Body
    if (requestConfig.formData) {
      init.body = requestConfig.formData;
    } else if (requestConfig.body !== undefined) {
      init.body = JSON.stringify(requestConfig.body);
      const hasContentType = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
      if (!hasContentType) {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    // Timeout via AbortController
    const timeout = requestConfig.timeout ?? this.config.timeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);
    init.signal = controller.signal;

    // Log request
    if (this.config.logHeaders) {
      reqLog('%s %s', requestConfig.method, url);
      for (const [k, v] of Object.entries(headers)) {
        reqLog('  %s: %s', k, v);
      }
    } else {
      reqLog('%s %s', requestConfig.method, url);
    }

    if (this.config.logRequestBody && requestConfig.body !== undefined) {
      reqLog('Body: %O', requestConfig.body);
    }

    try {
      const res = await fetch(url, init);
      clearTimeout(timer);

      const apiResponse = await ApiResponse.fromFetch<T>(res);

      // Log response
      resLog('%d %s', apiResponse.status, apiResponse.statusText);

      if (this.config.detailedLogging && apiResponse.rawBody) {
        resLog('Body: %s', apiResponse.rawBody);
      }

      return apiResponse;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new WasapiException(`Request timed out after ${timeout}s: ${requestConfig.method} ${url}`);
      }
      throw err;
    }
  }

  private buildUrl(config: RequestConfig): string {
    let path = config.path;

    // Substitute path params — :param style (replaceAll for repeated params)
    if (config.pathParams) {
      for (const [key, value] of Object.entries(config.pathParams)) {
        path = path.replaceAll(`:${key}`, encodeURIComponent(value));
      }
    }

    // Validate no unmatched params remain
    const unmatched = path.match(/:([a-zA-Z_]\w*)/g);
    if (unmatched) {
      throw new WasapiException(
        `Unmatched path parameters in "${config.path}": ${unmatched.join(', ')}. ` +
        `Provide values via pathParams.`
      );
    }

    const base = this.config.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${base}${normalizedPath}`;

    // Query params
    if (config.queryParams) {
      const params = new URLSearchParams(config.queryParams);
      const qs = params.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    return url;
  }

  /**
   * Build a typed API proxy from a decorated class.
   * Mirrors Retrofit's `retrofit.create(Service.class)`.
   */
  build<T>(ApiClass: new () => T): T {
    // Instantiate to trigger decorator registration
    const instance = new ApiClass();
    const client = this;

    return new Proxy(instance as object, {
      get(target, prop, receiver) {
        const methodName = String(prop);
        const meta = httpMetadata.get(ApiClass.prototype, methodName);

        if (!meta) {
          return Reflect.get(target, prop, receiver);
        }

        return (...args: unknown[]) => {
          const hasBody = meta.hasBody ?? BODY_METHODS.has(meta.method as HttpMethod);

          let body: unknown | undefined;
          let pathParams: Record<string, string> | undefined;
          let queryParams: Record<string, string> | undefined;
          let options: CallOptions | undefined;

          if (hasBody) {
            [body, pathParams, queryParams, options] = args as [
              unknown,
              Record<string, string>?,
              Record<string, string>?,
              CallOptions?,
            ];
          } else {
            [pathParams, queryParams, options] = args as [
              Record<string, string>?,
              Record<string, string>?,
              CallOptions?,
            ];
          }

          const requestConfig: RequestConfig = {
            method: meta.method,
            path: meta.path,
            body,
            pathParams,
            queryParams,
            headers: options?.headers,
            timeout: options?.timeout,
            formData: options?.formData,
          };

          return new ApiCall(client, requestConfig);
        };
      },
    }) as T;
  }

  // ── Multipart Utilities ──────────────────────────────────────

  /**
   * Create a FormData multipart body from a file path.
   * Mirrors Java's `WasapiUtilities.getMultipartFromFile(file, name, mediaType)`.
   *
   * @param filePath - Path to the file on disk.
   * @param fieldName - The form field name for the file part.
   * @param mediaType - Optional MIME type. Auto-detected from extension if omitted.
   */
  static getMultipartFromFile(filePath: string, fieldName: string, mediaType?: string): FormData {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mime = mediaType ?? guessMimeType(fileName);
    const blob = new Blob([buffer], { type: mime });

    const formData = new FormData();
    formData.append(fieldName, blob, fileName);
    return formData;
  }

  /**
   * Read a file into a Buffer with its MIME type.
   * Mirrors Java's `WasapiUtilities.getRequestBodyFromFile(file, mediaType)`.
   *
   * @param filePath - Path to the file on disk.
   * @param mediaType - Optional MIME type. Auto-detected from extension if omitted.
   */
  static getRequestBodyFromFile(filePath: string, mediaType?: string): { buffer: Buffer; mediaType: string } {
    const buffer = fs.readFileSync(filePath);
    const mime = mediaType ?? guessMimeType(path.basename(filePath));
    return { buffer, mediaType: mime };
  }

  // ── Builder ──────────────────────────────────────────────────

  static Builder = class Builder {
    #baseUrl = '';
    #headers: Record<string, string> = {};
    #timeout = 60;
    #logHeaders = true;
    #logRequestBody = false;
    #detailedLogging = false;
    #followRedirects = false;

    constructor(store?: ContextStore) {
      if (store) {
        this.#baseUrl = store.get<string>('wasapi.baseUrl', '');
        this.#timeout = store.getNumber('wasapi.timeout', 60);
        this.#logHeaders = store.getBoolean('wasapi.logHeaders', true);
        this.#logRequestBody = store.getBoolean('wasapi.logRequestBody', false);
        this.#detailedLogging = store.getBoolean('wasapi.detailedLogging', false);
        this.#followRedirects = store.getBoolean('wasapi.followRedirects', false);
      }
    }

    setBaseUrl(url: string): this {
      this.#baseUrl = url;
      return this;
    }

    setHeaders(headers: Record<string, string>): this {
      this.#headers = { ...this.#headers, ...headers };
      return this;
    }

    setTimeout(seconds: number): this {
      this.#timeout = seconds;
      return this;
    }

    setLogHeaders(enabled: boolean): this {
      this.#logHeaders = enabled;
      return this;
    }

    setLogRequestBody(enabled: boolean): this {
      this.#logRequestBody = enabled;
      return this;
    }

    setDetailedLogging(enabled: boolean): this {
      this.#detailedLogging = enabled;
      return this;
    }

    setFollowRedirects(follow: boolean): this {
      this.#followRedirects = follow;
      return this;
    }

    build<T>(ApiClass: new () => T): T {
      if (!this.#baseUrl) {
        throw new WasapiException('baseUrl is required. Call setBaseUrl() before build().');
      }

      const config: ClientConfig = {
        baseUrl: this.#baseUrl,
        headers: this.#headers,
        timeout: this.#timeout,
        logHeaders: this.#logHeaders,
        logRequestBody: this.#logRequestBody,
        detailedLogging: this.#detailedLogging,
        followRedirects: this.#followRedirects,
      };

      const client = new WasapiClient(config);
      return client.build(ApiClass);
    }

    /**
     * Returns a raw WasapiClient instance for direct execute() calls
     * without needing a decorated API class.
     */
    buildRaw(): WasapiClient {
      if (!this.#baseUrl) {
        throw new WasapiException('baseUrl is required. Call setBaseUrl() before buildRaw().');
      }

      const config: ClientConfig = {
        baseUrl: this.#baseUrl,
        headers: this.#headers,
        timeout: this.#timeout,
        logHeaders: this.#logHeaders,
        logRequestBody: this.#logRequestBody,
        detailedLogging: this.#detailedLogging,
        followRedirects: this.#followRedirects,
      };

      return new WasapiClient(config);
    }
  };
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    json: 'application/json',
    xml: 'application/xml',
    pdf: 'application/pdf',
    zip: 'application/zip',
    gz: 'application/gzip',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
