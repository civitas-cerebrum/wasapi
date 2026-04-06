import { ContextStore } from '@civitas-cerebrum/context-store';
import { ClientConfig, HttpMethod, RequestConfig } from '../models/types';
import { ApiResponse } from '../models/ApiResponse';
import { ApiCall } from '../models/ApiCall';
import { WasapiException } from '../exceptions/WasapiException';
import { httpMetadata } from '../decorators/http';
import { log, createLogger } from '../logger/Logger';

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
      method: typeof requestConfig.method === 'string' ? requestConfig.method : requestConfig.method,
      headers,
      redirect: this.config.followRedirects ? 'follow' : 'manual',
    };

    // Body
    if (requestConfig.formData) {
      init.body = requestConfig.formData;
    } else if (requestConfig.body !== undefined) {
      init.body = JSON.stringify(requestConfig.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
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

    // Substitute path params — :param style
    if (config.pathParams) {
      for (const [key, value] of Object.entries(config.pathParams)) {
        path = path.replace(`:${key}`, encodeURIComponent(value));
      }
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
          let options: { headers?: Record<string, string>; timeout?: number } | undefined;

          if (hasBody) {
            [body, pathParams, queryParams, options] = args as [
              unknown,
              Record<string, string>?,
              Record<string, string>?,
              { headers?: Record<string, string>; timeout?: number }?,
            ];
          } else {
            [pathParams, queryParams, options] = args as [
              Record<string, string>?,
              Record<string, string>?,
              { headers?: Record<string, string>; timeout?: number }?,
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
          };

          return new ApiCall(client, requestConfig);
        };
      },
    }) as T;
  }

  static Builder = class Builder {
    #baseUrl = '';
    #headers: Record<string, string> = {};
    #timeout = 60;
    #proxy: { host: string; port: number } | null = null;
    #hostnameVerification = true;
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
        this.#hostnameVerification = store.getBoolean('wasapi.hostnameVerification', true);
        this.#followRedirects = store.getBoolean('wasapi.followRedirects', false);

        const proxyHost = store.get<string>('wasapi.proxyHost', '');
        if (proxyHost) {
          this.#proxy = {
            host: proxyHost,
            port: store.getNumber('wasapi.proxyPort', 8888),
          };
        }
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

    setProxy(host: string, port: number): this {
      this.#proxy = { host, port };
      return this;
    }

    setHostnameVerification(enabled: boolean): this {
      this.#hostnameVerification = enabled;
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
        proxy: this.#proxy,
        hostnameVerification: this.#hostnameVerification,
        logHeaders: this.#logHeaders,
        logRequestBody: this.#logRequestBody,
        detailedLogging: this.#detailedLogging,
        followRedirects: this.#followRedirects,
      };

      const client = new WasapiClient(config);
      return client.build(ApiClass);
    }
  };
}
