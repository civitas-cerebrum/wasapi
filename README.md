# Wasapi 🌶️

[![npm](https://img.shields.io/npm/v/@civitas-cerebrum/wasapi?color=brightgreen&label=wasapi)](https://www.npmjs.com/package/@civitas-cerebrum/wasapi)

**Wasapi** is a lightweight TypeScript REST API client library that simplifies HTTP service generation using decorator-based API definitions, a fluent builder, typed responses, and smart polling utilities.

The TypeScript counterpart of [wasapi for Java](https://github.com/Umutayb/wasapi) — same design philosophy, native TypeScript experience.

## Features

- **Decorator-based API definitions** — `@GET`, `@POST`, `@PUT`, `@DELETE`, `@PATCH`, `@HTTP`
- **Fluent builder** — configure base URL, headers, timeouts, proxy, logging
- **Typed responses** — `ApiCall<T>`, `ApiResponse<T>`, `ResponsePair<R, E>`
- **Strict / lenient modes** — throw on failure or return null
- **Response polling** — `monitorResponseCode()`, `monitorFieldValue()`
- **Zero HTTP dependencies** — uses native `fetch` (Node 18+)
- **TC39 Stage 3 decorators** — no `experimentalDecorators`, no `reflect-metadata`

## Installation

```bash
npm install @civitas-cerebrum/wasapi
```

## Quick Start

### 1. Define your API with decorators

```typescript
import { GET, POST, DELETE, ApiCall } from '@civitas-cerebrum/wasapi';

interface User {
  id: string;
  name: string;
  email: string;
}

class UserApi {
  @GET('/users')
  getUsers(): ApiCall<User[]> { return null!; }

  @GET('/users/:id')
  getUser(pathParams: { id: string }): ApiCall<User> { return null!; }

  @POST('/users')
  createUser(body: { name: string; email: string }): ApiCall<User> { return null!; }

  @DELETE('/users/:id')
  deleteUser(pathParams: { id: string }): ApiCall<void> { return null!; }
}
```

### 2. Build the client

```typescript
import { WasapiClient } from '@civitas-cerebrum/wasapi';

const api = new WasapiClient.Builder()
  .setBaseUrl('https://api.example.com')
  .setHeaders({ Authorization: 'Bearer token' })
  .setLogHeaders(true)
  .build(UserApi);
```

### 3. Execute requests

```typescript
// Lenient mode (default) — returns null on failure
const users = await api.getUsers().perform();

// Strict mode — throws FailedCallException on non-2xx
const users = await api.getUsers().perform(true);

// Strict + log response body
const users = await api.getUsers().perform(true, true);

// Full response wrapper
const response = await api.getUser({ id: '5' }).getResponse();
console.log(response.status);    // 200
console.log(response.body);      // User object
console.log(response.headers);   // Record<string, string>

// Typed error handling
const pair = await api.getUser({ id: 'bad' }).getResponsePair(ErrorModel);
if (pair.isError()) {
  console.log(pair.errorBody);   // ErrorModel instance
}
```

## API Reference

### Decorators

| Decorator | Description | Method args |
|-----------|-------------|-------------|
| `@GET(path)` | HTTP GET | `(pathParams?, queryParams?, options?)` |
| `@POST(path)` | HTTP POST | `(body?, pathParams?, queryParams?, options?)` |
| `@PUT(path)` | HTTP PUT | `(body?, pathParams?, queryParams?, options?)` |
| `@PATCH(path)` | HTTP PATCH | `(body?, pathParams?, queryParams?, options?)` |
| `@DELETE(path)` | HTTP DELETE | `(pathParams?, queryParams?, options?)` |
| `@HTTP(method, path, hasBody?)` | Custom method | positional based on `hasBody` |

**Path parameters** use `:param` syntax — e.g., `/users/:id` is substituted from `pathParams: { id: '5' }`.

**Query parameters** are appended as `?key=value` from `queryParams: Record<string, string>`.

### `@HTTP` — Custom HTTP Methods

For unconventional methods like `PURGE`, `COPY`, or `LOCK`:

```typescript
import { HTTP, ApiCall } from '@civitas-cerebrum/wasapi';

class CacheApi {
  @HTTP('PURGE', '/cache/:key')
  purge(pathParams: { key: string }): ApiCall<void> { return null!; }

  @HTTP('REPORT', '/analytics', true)  // hasBody = true
  report(body: ReportRequest): ApiCall<ReportResult> { return null!; }
}
```

### `WasapiClient.Builder`

| Method | Description | Default |
|--------|-------------|---------|
| `setBaseUrl(url)` | Base URL for all requests | *required* |
| `setHeaders(headers)` | Default headers (merged per-request) | `{}` |
| `setTimeout(seconds)` | Request timeout | `60` |
| `setProxy(host, port)` | HTTP proxy | `null` |
| `setHostnameVerification(bool)` | TLS hostname verification | `true` |
| `setLogHeaders(bool)` | Log request headers | `true` |
| `setLogRequestBody(bool)` | Log request body | `false` |
| `setDetailedLogging(bool)` | Log response body | `false` |
| `setFollowRedirects(bool)` | Follow HTTP redirects | `false` |
| `build(ApiClass)` | Build typed API proxy | — |

Pass a `ContextStore` instance to the constructor to read defaults from configuration:

```typescript
const store = new ContextStore();
store.put('wasapi.baseUrl', 'https://api.example.com');
store.put('wasapi.timeout', 30);

const api = new WasapiClient.Builder(store).build(MyApi);
```

### `ApiCall<T>`

Every decorated method returns an `ApiCall<T>` — a lazy request descriptor that doesn't execute until you call one of its methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `perform(strict?, printBody?, ...errorModels)` | `Promise<T \| null>` | Execute and return body. Strict throws on failure. |
| `getResponse(strict?, printBody?)` | `Promise<ApiResponse<T>>` | Full response wrapper with status, headers, body. |
| `getResponsePair(ErrorClass)` | `Promise<ResponsePair<ApiResponse<T>, E>>` | Response + typed error body. |
| `monitorResponseCode(code, timeout, interval?)` | `Promise<ApiResponse<T>>` | Poll until HTTP status matches. |
| `monitorFieldValue(field, value, timeout, interval?)` | `Promise<T>` | Poll until a response body field matches. |
| `clone()` | `ApiCall<T>` | Independent copy for retry/polling. |

### `ApiResponse<T>`

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `status` | `number` | HTTP status code |
| `statusText` | `string` | HTTP status text |
| `headers` | `Record<string, string>` | Response headers |
| `ok` | `boolean` | True if status 200-299 |
| `body` | `T \| null` | Parsed JSON body |
| `rawBody` | `string` | Raw response text |
| `isSuccessful()` | `boolean` | Same as `ok` |
| `errorBody(ErrorClass?)` | `E \| null` | Deserialize error body |

### `ResponsePair<R, E>`

| Property / Method | Type | Description |
|-------------------|------|-------------|
| `response` | `R` | The API response |
| `errorBody` | `E \| null` | Typed error body (null on success) |
| `isError()` | `boolean` | True if errorBody is not null |

### Exceptions

| Class | Description |
|-------|-------------|
| `FailedCallException` | Thrown in strict mode on non-2xx. Has `statusCode`, `responseBody`, `url`. |
| `WasapiException` | General library error (timeout, missing config, etc.) |

## Logging

Uses the `debug` package with `wasapi:*` namespace. Enabled by default.

```bash
# Suppress all wasapi logs
WASAPI_DEBUG=false npx tsx tests/my-test.ts

# Show only request logs
DEBUG=wasapi:request npx tsx tests/my-test.ts
```

## Comparison with Java Wasapi

| Java (Retrofit) | TypeScript (this package) |
|-----------------|--------------------------|
| `@GET` / `@POST` annotations on interface | `@GET` / `@POST` decorators on class methods |
| `retrofit.create(Service.class)` | `builder.build(ServiceClass)` — returns Proxy |
| `Call<T>` | `ApiCall<T>` |
| `Response<T>` | `ApiResponse<T>` |
| `ResponsePair<R, E>` | `ResponsePair<R, E>` |
| `Caller.perform(call, strict, printBody)` | `apiCall.perform(strict, printBody)` |
| `WasapiUtilities.monitorResponseCode()` | `apiCall.monitorResponseCode()` |
| Extend `WasapiUtilities` | No inheritance needed — all on `ApiCall<T>` |

## License

MIT
