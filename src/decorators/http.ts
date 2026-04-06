import { HttpMethod } from '../models/types';

interface HttpMetadataEntry {
  method: HttpMethod | string;
  path: string;
  hasBody?: boolean;
}

/**
 * Metadata storage for HTTP decorator registration.
 * Keyed by class prototype → method name → metadata.
 */
class HttpMetadataStore {
  private store = new Map<object, Map<string, HttpMetadataEntry>>();

  set(prototype: object, methodName: string, entry: HttpMetadataEntry): void {
    if (!this.store.has(prototype)) {
      this.store.set(prototype, new Map());
    }
    this.store.get(prototype)!.set(methodName, entry);
  }

  get(prototype: object, methodName: string): HttpMetadataEntry | undefined {
    return this.store.get(prototype)?.get(methodName);
  }
}

export const httpMetadata = new HttpMetadataStore();

/**
 * Creates a TC39 Stage 3 method decorator for a standard HTTP method.
 */
function createHttpDecorator(method: HttpMethod) {
  return (path: string) => {
    return (_target: unknown, context: ClassMethodDecoratorContext) => {
      context.addInitializer(function (this: unknown) {
        httpMetadata.set(
          Object.getPrototypeOf(this as object) as object,
          String(context.name),
          { method, path },
        );
      });
    };
  };
}

/** `@GET('/path')` — HTTP GET request. Args: (pathParams?, queryParams?, options?) */
export const GET = createHttpDecorator(HttpMethod.GET);

/** `@POST('/path')` — HTTP POST request. Args: (body?, pathParams?, queryParams?, options?) */
export const POST = createHttpDecorator(HttpMethod.POST);

/** `@PUT('/path')` — HTTP PUT request. Args: (body?, pathParams?, queryParams?, options?) */
export const PUT = createHttpDecorator(HttpMethod.PUT);

/** `@DELETE('/path')` — HTTP DELETE request. Args: (pathParams?, queryParams?, options?) */
export const DELETE = createHttpDecorator(HttpMethod.DELETE);

/** `@PATCH('/path')` — HTTP PATCH request. Args: (body?, pathParams?, queryParams?, options?) */
export const PATCH = createHttpDecorator(HttpMethod.PATCH);

/**
 * `@HTTP('PURGE', '/cache/:key')` — Custom HTTP method decorator.
 *
 * @param method - The HTTP method string (e.g., 'PURGE', 'COPY', 'LOCK').
 * @param path - The URL path template.
 * @param hasBody - Whether the first argument is a request body. Default: false.
 */
export function HTTP(method: string, path: string, hasBody = false) {
  return (_target: unknown, context: ClassMethodDecoratorContext) => {
    context.addInitializer(function (this: unknown) {
      httpMetadata.set(
        Object.getPrototypeOf(this as object) as object,
        String(context.name),
        { method, path, hasBody },
      );
    });
  };
}
