---
name: wasapi
description: >
  Use this skill whenever the user wants to call a REST API, build an HTTP client, or wire up
  service requests in a TypeScript project that has @civitas-cerebrum/wasapi installed.
  Triggers on: "wasapi", "@civitas-cerebrum/wasapi", "WasapiClient", "ApiCall", "ApiResponse",
  "ResponsePair", "FailedCallException", `@GET` / `@POST` / `@PUT` / `@DELETE` / `@PATCH` / `@HTTP`
  decorators on a class, a `Builder` chain calling `setBaseUrl`, anything mentioning
  `monitorResponseCode` or `monitorFieldValue`, or any request to write/fix/explain a
  decorator-based REST client. Also triggers on general intents — "call this API", "wire up an
  HTTP client", "make a typed fetch wrapper", "talk to a backend", "consume a REST endpoint",
  "poll an endpoint until it's ready" — when the project's package.json already depends on
  `@civitas-cerebrum/wasapi`. Always consult this skill before generating decorator code,
  builder calls, or `ApiCall<T>` usage — do not invent argument orders, option shapes, or
  method signatures from memory; the conventions are specific (body comes first on POST/PUT/PATCH,
  timeout units differ between builder and polling, lenient vs strict modes return different
  things on failure) and easy to get wrong without this reference.
---

# @civitas-cerebrum/wasapi — Agent Skill

`wasapi` is a lightweight TypeScript REST API client. You define your API as a class with method decorators (`@GET`, `@POST`, …); a fluent builder produces a typed proxy that turns each call into a lazy `ApiCall<T>` you execute when ready. Zero HTTP dependencies — uses native `fetch` (Node 18+).

This skill is the consumer-facing usage guide. If a method signature, argument order, or option shape isn't specified here, **stop and read the package's `dist/` types** rather than guessing — wrong argument order silently produces a broken request.

## When to read which section

| You're about to… | Read |
|---|---|
| Define an API class with decorators | [§ Defining APIs](#defining-apis) — argument order rules are non-obvious |
| Build a client | [§ Building a client](#building-a-client) — required vs optional builder methods |
| Execute a request | [§ Executing requests](#executing-requests) — `perform` vs `getResponse` vs `getResponsePair` |
| Decide between strict and lenient | [§ Strict vs lenient mode](#strict-vs-lenient-mode) |
| Poll an endpoint | [§ Polling utilities](#polling-utilities) — timeout units differ from the builder |
| Send multipart / file uploads | [§ File uploads](#file-uploads) |
| Use a non-standard verb (PURGE, COPY, …) | [§ Custom HTTP methods](#custom-http-methods) |
| Drive `WasapiClient` directly without decorators | [§ Raw client](#raw-client) |
| Diagnose a failure | [§ Exceptions](#exceptions) and [§ Logging](#logging) |

---

## 🚨 Conventions that bite if you forget them

Read this section every time before writing decorator code. These are the things that compile fine but produce wrong runtime behaviour.

### 1. Argument order depends on the HTTP verb

Decorated methods accept different argument shapes depending on whether the verb has a body:

| Verbs | Method signature |
|---|---|
| `@GET`, `@DELETE` | `(pathParams?, queryParams?, options?)` |
| `@POST`, `@PUT`, `@PATCH` | `(body?, pathParams?, queryParams?, options?)` |
| `@HTTP(method, path, hasBody?)` | `hasBody=true` → body-first; `hasBody=false` (default) → no-body shape |

**Why this matters:** there are no named parameters at the call site. If you put `pathParams` where `body` should go on a POST, the runtime sends your path-params object as the JSON body and the path stays unsubstituted. TypeScript can't catch this if both happen to be plain objects.

### 2. `perform()` returns `null` for two unrelated reasons in lenient mode

In the default **lenient** mode, `perform()` returns `null` on:
- A failed request (4xx/5xx with no error model match), AND
- A successful but empty response (e.g. 204 No Content).

If you need to distinguish them, use `getResponse()` and check `response.status` / `response.ok`. This is the most common source of "why is my code thinking the call succeeded when it didn't?" bugs.

### 3. Timeout units are inconsistent

- `Builder.setTimeout(seconds)` — **seconds**.
- `monitorResponseCode(code, timeout, interval?)` and `monitorFieldValue(field, value, timeout, interval?)` — **milliseconds** for both `timeout` and `interval`.

Yes, this is asymmetric. The builder's units come from the Java original; the polling units come from the JS ecosystem.

### 4. Response bodies are plain JSON, not class instances

`ApiCall<User>.perform()` returns a plain object shaped like `User` — *not* an instance of `User`. Don't put methods on your response interfaces and expect them to be callable. This matches every other TS REST client (axios, ky, ofetch).

### 5. Selectors-style mistakes — path params come from `:name` syntax, not `{name}`

Path templates use Retrofit-style colons: `/users/:id`, not `/users/{id}`. The substitution comes from the `pathParams` object's keys. Unmatched `:name` placeholders throw `WasapiException` at request time — fail loudly, not silently.

### 6. Don't call `setBaseUrl` after `build()`

The builder snapshots config into the client at `build(...)`. Mutating the builder afterwards has no effect on already-built clients. Build per logical service.

---

## Defining APIs

Decorate methods on a class. Each method's body returns `null!` — the decorator overrides it via a Proxy, so the body is never executed. The return type annotation `ApiCall<T>` is what gives consumers type safety on the response.

```typescript
import { GET, POST, PUT, DELETE, PATCH, ApiCall } from '@civitas-cerebrum/wasapi';

interface User { id: string; name: string; email: string; }
interface CreateUser { name: string; email: string; }

class UserApi {
  @GET('/users')
  list(): ApiCall<User[]> { return null!; }

  @GET('/users/:id')
  get(pathParams: { id: string }): ApiCall<User> { return null!; }

  @POST('/users')
  create(body: CreateUser): ApiCall<User> { return null!; }

  @PUT('/users/:id')
  replace(body: User, pathParams: { id: string }): ApiCall<User> { return null!; }

  @PATCH('/users/:id')
  update(body: Partial<User>, pathParams: { id: string }): ApiCall<User> { return null!; }

  @DELETE('/users/:id')
  remove(pathParams: { id: string }): ApiCall<void> { return null!; }
}
```

**Why the `null!` body?** TypeScript needs a function body to type-check the return. The decorator replaces the implementation entirely via `Proxy`, so the body is dead code. Don't put logic in there — it won't run.

### Path and query parameters

```typescript
class SearchApi {
  @GET('/orgs/:orgId/repos/:repo/issues')
  issues(
    pathParams: { orgId: string; repo: string },
    queryParams?: { state: 'open' | 'closed'; per_page: string },
  ): ApiCall<Issue[]> { return null!; }
}

await api.issues(
  { orgId: 'civitas-cerebrum', repo: 'wasapi' },
  { state: 'open', per_page: '50' },
).perform();
```

`queryParams` is `Record<string, string>` — coerce numbers and booleans yourself if needed (`String(50)`, `String(true)`).

### Per-call options

The trailing `options` argument lets you override headers, timeout, or attach `FormData` for one call:

```typescript
@POST('/users')
create(body: CreateUser, pathParams?: undefined, queryParams?: undefined, options?: CallOptions): ApiCall<User> { return null!; }

await api.create(
  { name: 'Ada', email: 'ada@example.com' },
  undefined, undefined,
  { timeout: 5, headers: { 'X-Request-Id': '...' } },
).perform();
```

`CallOptions` shape: `{ headers?: Record<string,string>; timeout?: number /* seconds */; formData?: FormData }`.

---

## Building a client

```typescript
import { WasapiClient } from '@civitas-cerebrum/wasapi';

const api = new WasapiClient.Builder()
  .setBaseUrl('https://api.example.com')          // required
  .setHeaders({ Authorization: `Bearer ${token}` })
  .setTimeout(30)                                  // seconds
  .setLogHeaders(true)
  .setDetailedLogging(false)
  .setFollowRedirects(false)
  .build(UserApi);                                 // returns a typed proxy
```

| Method | Default | Notes |
|---|---|---|
| `setBaseUrl(url)` | — | Required. Throws if missing at `build()`. |
| `setHeaders(headers)` | `{}` | Merged with per-request headers (per-request wins). |
| `setTimeout(seconds)` | `60` | **Seconds**, not ms. |
| `setLogHeaders(bool)` | `true` | Logs request method, URL, and headers. |
| `setLogRequestBody(bool)` | `false` | Logs JSON request body. |
| `setDetailedLogging(bool)` | `false` | Logs response body. |
| `setFollowRedirects(bool)` | `false` | Native `fetch` redirect mode. |

### Reading config from a `ContextStore`

The builder's constructor accepts a `@civitas-cerebrum/context-store` instance. It pre-fills any of the above from these keys:

- `wasapi.baseUrl`, `wasapi.timeout`, `wasapi.logHeaders`, `wasapi.logRequestBody`, `wasapi.detailedLogging`, `wasapi.followRedirects`.

Subsequent `set*` calls still win — the store provides defaults, not overrides.

```typescript
const store = new ContextStore();
store.put('wasapi.baseUrl', 'https://api.example.com');
const api = new WasapiClient.Builder(store).build(UserApi);
```

---

## Executing requests

Every decorated method returns an `ApiCall<T>` — a **lazy** request descriptor. Nothing hits the network until you call one of these:

| Method | Returns | When to use |
|---|---|---|
| `perform(strict?, printBody?, ...errorModels)` | `Promise<T \| null>` | You want the body. Default for happy-path calls. |
| `getResponse(strict?, printBody?, ...errorModels)` | `Promise<ApiResponse<T>>` | You need status / headers / `ok` flag. |
| `getResponsePair(ErrorClass)` | `Promise<ResponsePair<ApiResponse<T>, E>>` | You want both the response and a typed error body in one call. |
| `clone()` | `ApiCall<T>` | Independent copy; use when retrying or polling so each attempt is fresh. |

### `perform()`

```typescript
const users = await api.list().perform();        // User[] | null
const user  = await api.get({ id: '5' }).perform(true);   // strict — throws on non-2xx
```

Signature: `perform(strict = false, printBody = false, ...errorModels: Array<new () => unknown>)`.

`errorModels` are constructors used to deserialize the response body when the call fails. The first one whose own keys match at least one parsed-JSON key wins. In **lenient** mode, that deserialized error is returned (cast to `T`); in **strict** mode, it's attached to the thrown `FailedCallException.errorBody`.

### `getResponse()`

Use when you need the full envelope:

```typescript
const res = await api.get({ id: '5' }).getResponse();
console.log(res.status);     // 200
console.log(res.headers);    // Record<string, string>
console.log(res.body);       // User | null  (JSON-parsed)
console.log(res.rawBody);    // string       (always present)
console.log(res.ok);         // status in 200–299
```

`ApiResponse<T>` also has `errorBody<E>(ErrorClass?)` — deserialize the raw body into a typed error when `ok === false`.

### `getResponsePair()`

When the success and error shapes are both useful in caller code:

```typescript
class ApiError { code?: string; message?: string; }

const pair = await api.get({ id: 'bad' }).getResponsePair(ApiError);
if (pair.isError()) {
  console.log(pair.errorBody!.message);  // typed
} else {
  console.log(pair.response.body!.name); // typed success
}
```

---

## Strict vs lenient mode

`perform(strict)` and `getResponse(strict)` both accept the strict flag. It changes failure behaviour, not success behaviour:

| Mode | On 2xx | On non-2xx |
|---|---|---|
| **Lenient** (default, `false`) | Returns body / response | `perform`: returns deserialized error or `null`. `getResponse`: returns the response object (you check `ok`). |
| **Strict** (`true`) | Returns body / response | Throws `FailedCallException` with status, raw body, URL, and deserialized `errorBody`. |

**When to use which:**

- **Strict** for "this must succeed" calls — auth, seed, any precondition. The exception carries everything you need to diagnose.
- **Lenient + `getResponse()`** when 4xx is a normal outcome (e.g. polling for resource creation, optimistic checks).
- **Lenient + `perform()`** for fire-and-forget calls where `null` is fine. Avoid if you also have legitimate empty 2xx responses — see Convention #2 above.

---

## Polling utilities

`ApiCall<T>` has two built-in polling helpers. Both retry until success or timeout, and **both use milliseconds** (unlike the builder).

### `monitorResponseCode(code, timeoutMs, intervalMs?)`

Re-execute the call until the HTTP status matches:

```typescript
const ready = await api.jobStatus({ id: jobId })
  .monitorResponseCode(200, 30_000, 1_000);   // wait up to 30s, polling every 1s
console.log(ready.body);
```

Throws `WasapiException` with the last response attached if the deadline passes.

### `monitorFieldValue(fieldPath, expected, timeoutMs, intervalMs?)`

Re-execute until a field in the JSON body matches. `fieldPath` is dot-notation; comparison is by `String(actual) === String(expected)`:

```typescript
await api.jobStatus({ id: jobId })
  .monitorFieldValue('data.state', 'COMPLETED', 60_000, 2_000);
```

The string-coercion comparison means `1` matches `'1'` and `true` matches `'true'`. If you need strict equality, do the polling yourself with `getResponse` in a loop.

**Reuse vs `clone()`:** Polling re-uses the `ApiCall`'s config without mutation, so the same call is safe to poll. If you want to fan out (poll the same endpoint with different polling strategies in parallel), `clone()` first.

---

## File uploads

For multipart bodies, build the `FormData` and pass it via the `options.formData` field on the call. The body argument should be `undefined` — the builder uses `formData` instead of JSON-encoding `body`.

```typescript
const form = WasapiClient.getMultipartFromFile('./avatar.png', 'avatar');
await api.uploadAvatar(undefined, undefined, { formData: form }).perform(true);
```

`getMultipartFromFile(filePath, fieldName, mediaType?)` reads from disk and constructs a `FormData` with one file part. MIME type is auto-detected from extension (`.png`, `.jpg`, `.pdf`, `.json`, `.zip`, …) or you can pass it explicitly.

For raw bytes + MIME (no FormData wrapper), use `WasapiClient.getRequestBodyFromFile(filePath, mediaType?)` which returns `{ buffer, mediaType }`.

---

## Custom HTTP methods

For verbs the standard decorators don't cover (`PURGE`, `COPY`, `LOCK`, `REPORT`, …), use `@HTTP(method, path, hasBody?)`:

```typescript
import { HTTP, ApiCall } from '@civitas-cerebrum/wasapi';

class CacheApi {
  @HTTP('PURGE', '/cache/:key')
  purge(pathParams: { key: string }): ApiCall<void> { return null!; }

  @HTTP('REPORT', '/analytics', true)   // hasBody = true → body-first signature
  report(body: ReportRequest): ApiCall<ReportResult> { return null!; }
}
```

`hasBody` defaults to `false`. Set it `true` if your custom verb takes a body — that's how the proxy knows whether to pull the body argument from position 0.

---

## Raw client

When you don't want decorators — for instance, dynamically-constructed paths, or one-off calls in scripts — use `Builder.buildRaw()` to get a `WasapiClient` and call `execute()` directly:

```typescript
const client = new WasapiClient.Builder()
  .setBaseUrl('https://api.example.com')
  .buildRaw();

const res = await client.execute<User>({
  method: 'GET',
  path: '/users/:id',
  pathParams: { id: '5' },
});
```

`execute()` returns `Promise<ApiResponse<T>>` (no lazy `ApiCall` wrapper). It still applies base URL, default headers, timeout, and logging — you just lose the typed proxy and the `perform`/`monitor*` helpers. Prefer decorators when you have a stable surface.

---

## Exceptions

| Class | Thrown when | Useful properties |
|---|---|---|
| `FailedCallException extends WasapiException` | Strict-mode call gets non-2xx | `statusCode`, `responseBody` (raw string), `url`, `errorBody` (deserialized via `errorModels`) |
| `WasapiException` | Timeout, missing config, unmatched path params, polling deadline exceeded | `lastResponse` (the most recent `ApiResponse` for polling failures) |

Catch the specific subclass first when you care about HTTP failures distinctly from config/timeout errors:

```typescript
try {
  await api.create(body).perform(true);
} catch (e) {
  if (e instanceof FailedCallException) {
    log.error('API rejected the call: %d %s', e.statusCode, e.responseBody);
  } else if (e instanceof WasapiException) {
    log.error('Transport / config issue: %s', e.message);
  } else {
    throw e;
  }
}
```

---

## Logging

Built on the `debug` package under the `wasapi:*` namespace. Enabled by default — Wasapi's own logs route through `wasapi:request`, `wasapi:response`, `wasapi:info`, `wasapi:warn`, `wasapi:error`, `wasapi:success`, `wasapi:important`.

```bash
# Suppress all wasapi logs
WASAPI_DEBUG=false npx tsx tests/my-test.ts

# Show only request logs
DEBUG=wasapi:request npx tsx tests/my-test.ts

# Show everything in the project
DEBUG=* npx tsx tests/my-test.ts
```

If `DEBUG` is already set in the environment, Wasapi respects it instead of force-enabling. Set `WASAPI_DEBUG=false` to silence regardless of `DEBUG`.

---

## Quick reference — common recipes

**GET with query params:**
```typescript
@GET('/search')
search(pathParams: undefined, queryParams: { q: string }): ApiCall<SearchResult> { return null!; }
await api.search(undefined, { q: 'wasapi' }).perform();
```

**Authenticated client (token from a prior login call):**
```typescript
const auth = await new WasapiClient.Builder()
  .setBaseUrl(BASE)
  .build(AuthApi)
  .login({ email, password })
  .perform(true);

const api = new WasapiClient.Builder()
  .setBaseUrl(BASE)
  .setHeaders({ Authorization: `Bearer ${auth!.token}` })
  .build(UserApi);
```

**Wait for a long-running job:**
```typescript
await api.startJob(payload).perform(true);
const result = await api.jobStatus({ id })
  .monitorFieldValue('status', 'DONE', 60_000, 2_000);
```

**Typed error handling without exceptions:**
```typescript
class ApiError { code?: string; message?: string; }
const pair = await api.create(body).getResponsePair(ApiError);
if (pair.isError()) return showError(pair.errorBody!.message);
return showSuccess(pair.response.body!);
```

**Per-call timeout override:**
```typescript
await api.slowReport(undefined, undefined, { timeout: 120 }).perform(true);  // 120s for this call only
```

---

## When this skill doesn't apply

- The project uses `axios`, `ky`, `ofetch`, raw `fetch`, or another HTTP client — those have their own conventions; don't port wasapi patterns to them.
- The user is asking about wasapi for **Java** (`com.umutayb:wasapi`) — different package; the design is parallel but the syntax is Java-decorator/Retrofit, not TS.
- The user is **contributing to the wasapi-ts library itself** (changing decorators, adding builder methods, etc.) — read `src/` directly; the conventions documented here are user-facing API, not internals.
