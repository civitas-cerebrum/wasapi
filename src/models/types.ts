export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
}

export interface RequestConfig {
  method: HttpMethod | string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  pathParams?: Record<string, string>;
  formData?: FormData;
  timeout?: number;
}

export interface ClientConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
  logHeaders: boolean;
  logRequestBody: boolean;
  detailedLogging: boolean;
  followRedirects: boolean;
}

export interface CallOptions {
  headers?: Record<string, string>;
  timeout?: number;
  formData?: FormData;
}
