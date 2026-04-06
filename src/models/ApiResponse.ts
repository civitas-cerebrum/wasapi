export class ApiResponse<T> {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly ok: boolean;
  readonly body: T | null;
  readonly rawBody: string;

  constructor(
    status: number,
    statusText: string,
    headers: Record<string, string>,
    ok: boolean,
    body: T | null,
    rawBody: string,
  ) {
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.ok = ok;
    this.body = body;
    this.rawBody = rawBody;
  }

  isSuccessful(): boolean {
    return this.ok;
  }

  errorBody<E extends object>(ErrorClass?: new () => E): E | null {
    if (this.ok) return null;
    if (!this.rawBody) return null;

    try {
      const parsed = JSON.parse(this.rawBody) as Record<string, unknown>;
      if (ErrorClass) {
        return Object.assign(new ErrorClass(), parsed) as E;
      }
      return parsed as unknown as E;
    } catch {
      return null;
    }
  }

  static async fromFetch<T>(res: globalThis.Response): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const rawBody = await res.text();
    let body: T | null = null;

    try {
      body = JSON.parse(rawBody) as T;
    } catch {
      // Non-JSON response — body stays null, rawBody has the text
    }

    return new ApiResponse<T>(
      res.status,
      res.statusText,
      headers,
      res.ok,
      body,
      rawBody,
    );
  }
}
