import { WasapiClient, GET, POST, PUT, DELETE, ApiCall, ApiResponse, ResponsePair, FailedCallException } from '../src/index';

// ── Response Models ──────────────────────────────────────────────

interface AuthResponse {
  token: string;
  userId: string;
  username: string;
  email: string;
  balance: number;
}

interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  price: number;
  coverImage: string;
  stock: number;
  isbn: string;
}

interface Page<T> {
  content: T[];
  totalPages: number;
  totalElements: number;
  first: boolean;
  last: boolean;
  size: number;
  number: number;
  numberOfElements: number;
  empty: boolean;
}

interface CartItem {
  id: string;
  userId: string;
  bookId: string;
  quantity: number;
  addedAt: string;
}

interface Order {
  id: string;
  userId: string;
  items: { bookId: string; quantity: number; priceAtPurchase: number }[];
  totalPrice: number;
  status: string;
  purchasedAt: string;
}

interface MarketplaceListing {
  id: string;
  sellerId: string;
  bookId: string;
  condition: string;
  price: number;
  listedAt: string;
  status: string;
}

interface HealthResponse {
  status: string;
  db: string;
}

interface StatusResponse {
  status: string;
}

class ErrorBody {
  message?: string;
  error?: string;
  status?: number;
}

// ── API Definitions ──────────────────────────────────────────────

class HealthApi {
  @GET('/api/health')
  health(): ApiCall<HealthResponse> { return null!; }

  @POST('/api/seed')
  seed(): ApiCall<StatusResponse> { return null!; }

  @POST('/api/reset')
  reset(): ApiCall<StatusResponse> { return null!; }
}

class AuthApi {
  @POST('/api/auth/signup')
  signup(body: { username: string; email: string; password: string }): ApiCall<AuthResponse> { return null!; }

  @POST('/api/auth/login')
  login(body: { email: string; password: string }): ApiCall<AuthResponse> { return null!; }

  @GET('/api/auth/me')
  me(): ApiCall<AuthResponse> { return null!; }

  @POST('/api/auth/logout')
  logout(): ApiCall<void> { return null!; }
}

class BooksApi {
  @GET('/api/books')
  list(pathParams?: Record<string, string>, queryParams?: Record<string, string>): ApiCall<Page<Book>> { return null!; }

  @GET('/api/books/:id')
  getById(pathParams: { id: string }): ApiCall<Book> { return null!; }
}

class CartApi {
  @GET('/api/cart')
  get(): ApiCall<CartItem[]> { return null!; }

  @POST('/api/cart/items')
  addItem(body: { bookId: string; quantity: number }): ApiCall<CartItem> { return null!; }

  @PUT('/api/cart/items/:id')
  updateItem(body: { quantity: number }, pathParams: { id: string }): ApiCall<CartItem> { return null!; }

  @DELETE('/api/cart/items/:id')
  removeItem(pathParams: { id: string }): ApiCall<void> { return null!; }

  @DELETE('/api/cart')
  clear(): ApiCall<void> { return null!; }
}

class OrdersApi {
  @POST('/api/orders')
  checkout(body?: unknown): ApiCall<Order> { return null!; }

  @GET('/api/orders')
  list(): ApiCall<Order[]> { return null!; }

  @GET('/api/orders/:id')
  getById(pathParams: { id: string }): ApiCall<Order> { return null!; }

  @POST('/api/orders/:id/return')
  returnOrder(body: unknown, pathParams: { id: string }): ApiCall<Order> { return null!; }
}

class MarketplaceApi {
  @GET('/api/marketplace')
  list(): ApiCall<MarketplaceListing[]> { return null!; }

  @POST('/api/marketplace/listings')
  create(body: { bookId: string; condition: string; price: number }): ApiCall<MarketplaceListing> { return null!; }

  @POST('/api/marketplace/listings/:id/buy')
  buy(body: unknown, pathParams: { id: string }): ApiCall<MarketplaceListing> { return null!; }

  @DELETE('/api/marketplace/listings/:id')
  cancel(pathParams: { id: string }): ApiCall<void> { return null!; }
}

// ── Test Helpers ─────────────────────────────────────────────────

const BASE_URL = 'http://localhost:8080';

function buildPublicApi<T>(ApiClass: new () => T): T {
  return new WasapiClient.Builder()
    .setBaseUrl(BASE_URL)
    .setLogHeaders(false)
    .build(ApiClass);
}

function buildAuthApi<T>(ApiClass: new () => T, token: string): T {
  return new WasapiClient.Builder()
    .setBaseUrl(BASE_URL)
    .setHeaders({ Authorization: `Bearer ${token}` })
    .setLogHeaders(false)
    .build(ApiClass);
}

// ── Tests ────────────────────────────────────────────────────────

async function main() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${name}`);
      console.log(`    ${msg}`);
      failed++;
    }
  }

  function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
  }

  // ── Setup ──
  const healthApi = buildPublicApi(HealthApi);
  const booksApi = buildPublicApi(BooksApi);

  // Reset DB
  await healthApi.reset().perform(true, false);

  // ── Health & Seed ──
  console.log('\n── Health & Seed ──');

  await test('GET /api/health — perform() returns parsed body', async () => {
    const body = await healthApi.health().perform(true);
    assert(body !== null, 'body should not be null');
    assert(body!.status === 'healthy', `expected "healthy", got "${body!.status}"`);
    assert(body!.db === 'connected', `expected "connected", got "${body!.db}"`);
  });

  await test('POST /api/seed — perform() strict mode', async () => {
    const body = await healthApi.seed().perform(true);
    assert(body !== null, 'body should not be null');
    assert(body!.status === 'seeded', `expected "seeded", got "${body!.status}"`);
  });

  // ── ApiCall.getResponse() ──
  console.log('\n── ApiCall.getResponse() ──');

  await test('getResponse() returns full ApiResponse wrapper', async () => {
    const resp = await healthApi.health().getResponse();
    assert(resp.status === 200, `expected 200, got ${resp.status}`);
    assert(resp.ok === true, 'expected ok to be true');
    assert(resp.body !== null, 'body should not be null');
    assert(resp.headers['content-type']?.includes('application/json') === true, 'expected JSON content-type');
    assert(typeof resp.rawBody === 'string', 'rawBody should be string');
    assert(resp.isSuccessful() === true, 'isSuccessful should return true');
  });

  // ── ApiCall.clone() ──
  console.log('\n── ApiCall.clone() ──');

  await test('clone() creates independent copy that executes independently', async () => {
    const call1 = healthApi.health();
    const call2 = call1.clone();
    const [resp1, resp2] = await Promise.all([call1.perform(true), call2.perform(true)]);
    assert(resp1!.status === 'healthy', 'original should work');
    assert(resp2!.status === 'healthy', 'clone should work');
  });

  // ── Books — GET with path params and query params ──
  console.log('\n── Books ──');

  await test('GET /api/books — list with pagination query params', async () => {
    const body = await booksApi.list(undefined, { page: '0', size: '5' }).perform(true);
    assert(body !== null, 'body should not be null');
    assert(body!.content.length <= 5, `expected at most 5 items, got ${body!.content.length}`);
    assert(body!.totalElements === 50, `expected 50 total, got ${body!.totalElements}`);
    assert(body!.size === 5, `expected page size 5, got ${body!.size}`);
  });

  await test('GET /api/books — search by query param', async () => {
    const body = await booksApi.list(undefined, { query: 'Mockingbird' }).perform(true);
    assert(body !== null, 'body should not be null');
    assert(body!.content.length > 0, 'expected at least 1 result');
    assert(body!.content[0].title.includes('Mockingbird'), `expected title with "Mockingbird"`);
  });

  await test('GET /api/books/:id — path param substitution', async () => {
    const book = await booksApi.getById({ id: 'book-001' }).perform(true);
    assert(book !== null, 'body should not be null');
    assert(book!.id === 'book-001', `expected "book-001", got "${book!.id}"`);
    assert(typeof book!.title === 'string', 'title should be string');
    assert(typeof book!.price === 'number', 'price should be number');
  });

  // ── Strict mode — FailedCallException ──
  console.log('\n── Strict / Lenient Modes ──');

  await test('strict mode throws FailedCallException on 404', async () => {
    try {
      await booksApi.getById({ id: 'nonexistent-book' }).perform(true);
      assert(false, 'should have thrown');
    } catch (err) {
      assert(err instanceof FailedCallException, `expected FailedCallException, got ${(err as Error).constructor.name}`);
      assert((err as FailedCallException).statusCode === 404, `expected 404, got ${(err as FailedCallException).statusCode}`);
    }
  });

  await test('lenient mode returns null on 404', async () => {
    const result = await booksApi.getById({ id: 'nonexistent-book' }).perform(false);
    assert(result === null, 'expected null in lenient mode');
  });

  // ── Error Models ──
  console.log('\n── Error Models ──');

  await test('strict mode with errorModels attaches deserialized errorBody to FailedCallException', async () => {
    const loginApi = buildPublicApi(AuthApi);
    try {
      // Login with wrong creds returns 401 with JSON: {"error":"login_failed","message":"Invalid credentials"}
      await loginApi.login({ email: 'wrong@test.com', password: 'wrong' }).perform(true, false, ErrorBody);
      assert(false, 'should have thrown');
    } catch (err) {
      assert(err instanceof FailedCallException, `expected FailedCallException, got ${(err as Error).constructor.name}`);
      const ex = err as FailedCallException;
      assert(ex.statusCode === 401, `expected 401, got ${ex.statusCode}`);
      assert(ex.errorBody !== null, 'errorBody should be attached to exception');
      assert((ex.errorBody as ErrorBody).message === 'Invalid credentials', `expected "Invalid credentials", got "${(ex.errorBody as ErrorBody).message}"`);
    }
  });

  await test('lenient mode with errorModels returns deserialized error body', async () => {
    const loginApi = buildPublicApi(AuthApi);
    const result = await loginApi.login({ email: 'wrong@test.com', password: 'wrong' }).perform(false, false, ErrorBody);
    assert(result !== null, 'should return deserialized error, not null');
    assert((result as unknown as ErrorBody).message === 'Invalid credentials', 'should have error message');
  });

  await test('getResponse() strict with errorModels attaches error to exception', async () => {
    const loginApi = buildPublicApi(AuthApi);
    try {
      await loginApi.login({ email: 'wrong@test.com', password: 'wrong' }).getResponse(true, false, ErrorBody);
      assert(false, 'should have thrown');
    } catch (err) {
      assert(err instanceof FailedCallException, `expected FailedCallException, got ${(err as Error).constructor.name}`);
      const ex = err as FailedCallException;
      assert(ex.errorBody !== null, 'errorBody should be attached');
      assert((ex.errorBody as ErrorBody).message === 'Invalid credentials', 'should have deserialized error message');
    }
  });

  // ── ApiCall.getResponsePair() ──
  console.log('\n── getResponsePair() ──');

  await test('getResponsePair returns ResponsePair with error body on failure', async () => {
    const pair = await booksApi.getById({ id: 'nonexistent' }).getResponsePair(ErrorBody);
    assert(pair instanceof ResponsePair, 'should be ResponsePair');
    assert(pair.response.status === 404, `expected 404, got ${pair.response.status}`);
    assert(pair.isError() || pair.errorBody === null, 'should have error or null errorBody');
  });

  await test('getResponsePair returns no error on success', async () => {
    const pair = await healthApi.health().getResponsePair(ErrorBody);
    assert(pair.response.ok === true, 'response should be ok');
    assert(pair.errorBody === null, 'errorBody should be null on success');
    assert(pair.isError() === false, 'isError should be false');
  });

  // ── Auth — signup, login, me ──
  console.log('\n── Auth ──');

  const authApi = buildPublicApi(AuthApi);
  let token1: string;
  let userId1: string;

  await test('POST /api/auth/login — get JWT token', async () => {
    const body = await authApi.login({ email: 'testuser1@bookhive.test', password: 'Test1234!' }).perform(true);
    assert(body !== null, 'body should not be null');
    assert(typeof body!.token === 'string', 'token should be string');
    assert(body!.email === 'testuser1@bookhive.test', 'email should match');
    token1 = body!.token;
    userId1 = body!.userId;
  });

  await test('GET /api/auth/me — authenticated request with JWT header', async () => {
    const authedAuth = buildAuthApi(AuthApi, token1);
    const body = await authedAuth.me().perform(true);
    assert(body !== null, 'body should not be null');
    assert(body!.userId === userId1, `userId should match`);
    assert(body!.email === 'testuser1@bookhive.test', 'email should match');
  });

  // ── Cart — full CRUD ──
  console.log('\n── Cart ──');

  const cartApi = buildAuthApi(CartApi, token1);
  let cartItemId: string;

  await test('POST /api/cart/items — add item to cart', async () => {
    const item = await cartApi.addItem({ bookId: 'book-001', quantity: 1 }).perform(true);
    assert(item !== null, 'body should not be null');
    assert(item!.bookId === 'book-001', 'bookId should match');
    assert(item!.quantity === 1, 'quantity should be 1');
    cartItemId = item!.id;
  });

  await test('GET /api/cart — list cart items', async () => {
    const items = await cartApi.get().perform(true);
    assert(items !== null, 'body should not be null');
    assert(items!.length >= 1, 'cart should have at least 1 item');
  });

  await test('PUT /api/cart/items/:id — update quantity', async () => {
    const updated = await cartApi.updateItem({ quantity: 2 }, { id: cartItemId }).perform(true);
    assert(updated !== null, 'body should not be null');
    assert(updated!.quantity === 2, `expected quantity 2, got ${updated!.quantity}`);
  });

  await test('DELETE /api/cart/items/:id — remove single item', async () => {
    const resp = await cartApi.removeItem({ id: cartItemId }).getResponse(true);
    assert(resp.status === 200, `expected 200, got ${resp.status}`);
  });

  await test('DELETE /api/cart — clear entire cart', async () => {
    await cartApi.addItem({ bookId: 'book-002', quantity: 1 }).perform(true);
    const resp = await cartApi.clear().getResponse(true);
    assert(resp.status === 200, `expected 200, got ${resp.status}`);
    const items = await cartApi.get().perform(true);
    assert(items!.length === 0, `expected empty cart, got ${items!.length} items`);
  });

  // ── Orders — checkout + return ──
  console.log('\n── Orders ──');

  const ordersApi = buildAuthApi(OrdersApi, token1);
  let orderId: string;

  await test('POST /api/orders — checkout creates order', async () => {
    // Add item to cart first
    await cartApi.addItem({ bookId: 'book-003', quantity: 1 }).perform(true);
    const order = await ordersApi.checkout({}).perform(true);
    assert(order !== null, 'body should not be null');
    assert(order!.status === 'COMPLETED', `expected COMPLETED, got ${order!.status}`);
    assert(order!.items.length === 1, 'should have 1 item');
    assert(order!.items[0].bookId === 'book-003', 'bookId should match');
    orderId = order!.id;
  });

  await test('GET /api/orders — list user orders', async () => {
    const orders = await ordersApi.list().perform(true);
    assert(orders !== null, 'body should not be null');
    assert(orders!.length >= 1, 'should have at least 1 order');
  });

  await test('GET /api/orders/:id — get order by ID', async () => {
    const order = await ordersApi.getById({ id: orderId }).perform(true);
    assert(order !== null, 'body should not be null');
    assert(order!.id === orderId, 'orderId should match');
  });

  await test('POST /api/orders/:id/return — return order', async () => {
    const returned = await ordersApi.returnOrder({}, { id: orderId }).perform(true);
    assert(returned !== null, 'body should not be null');
    assert(returned!.status === 'RETURNED', `expected RETURNED, got ${returned!.status}`);
  });

  // ── Marketplace ──
  console.log('\n── Marketplace ──');

  const marketApi1 = buildAuthApi(MarketplaceApi, token1);
  let listingId: string;

  await test('POST /api/marketplace/listings — create listing', async () => {
    const listing = await marketApi1.create({ bookId: 'book-010', condition: 'GOOD', price: 7.99 }).perform(true);
    assert(listing !== null, 'body should not be null');
    assert(listing!.status === 'ACTIVE', `expected ACTIVE, got ${listing!.status}`);
    assert(listing!.condition === 'GOOD', 'condition should match');
    listingId = listing!.id;
  });

  await test('GET /api/marketplace — list active listings', async () => {
    const listings = await marketApi1.list().perform(true);
    assert(listings !== null, 'body should not be null');
    assert(listings!.length >= 1, 'should have at least 1 listing');
  });

  await test('POST /api/marketplace/listings/:id/buy — buy listing', async () => {
    // Login as user2 to buy
    const user2Auth = await authApi.login({ email: 'testuser2@bookhive.test', password: 'Test1234!' }).perform(true);
    const marketApi2 = buildAuthApi(MarketplaceApi, user2Auth!.token);
    const bought = await marketApi2.buy({}, { id: listingId }).perform(true);
    assert(bought !== null, 'body should not be null');
    assert(bought!.status === 'COMPLETED' || bought!.status === 'SOLD', `expected COMPLETED or SOLD, got ${bought!.status}`);
  });

  await test('DELETE /api/marketplace/listings/:id — cancel own listing', async () => {
    // Create another listing then cancel it
    const listing = await marketApi1.create({ bookId: 'book-020', condition: 'FAIR', price: 5.00 }).perform(true);
    const resp = await marketApi1.cancel({ id: listing!.id }).getResponse(true);
    assert(resp.status === 200, `expected 200, got ${resp.status}`);
  });

  // ── Polling — monitorResponseCode ──
  console.log('\n── Polling ──');

  await test('monitorResponseCode — succeeds when code matches', async () => {
    const resp = await healthApi.health().monitorResponseCode(200, 5000, 500);
    assert(resp.status === 200, `expected 200, got ${resp.status}`);
  });

  await test('monitorFieldValue — polls until field matches', async () => {
    const body = await healthApi.health().monitorFieldValue('status', 'healthy', 5000, 500);
    assert(body !== null, 'body should not be null');
    assert(body!.status === 'healthy', `expected "healthy"`);
  });

  // ── ApiResponse.errorBody() ──
  console.log('\n── ApiResponse.errorBody() ──');

  await test('errorBody() returns null on success', async () => {
    const resp = await healthApi.health().getResponse();
    const err = resp.errorBody<ErrorBody>(ErrorBody);
    assert(err === null, 'errorBody should be null on success');
  });

  // ── Multipart Utilities ──
  console.log('\n── Multipart Utilities ──');

  await test('getMultipartFromFile creates FormData from file', async () => {
    const formData = WasapiClient.getMultipartFromFile('package.json', 'file');
    assert(formData instanceof FormData, 'should return FormData');
    assert(formData.has('file'), 'should have the "file" field');
  });

  await test('getRequestBodyFromFile reads file with mime type', async () => {
    const result = WasapiClient.getRequestBodyFromFile('package.json', 'application/json');
    assert(result.buffer instanceof Buffer, 'should return Buffer');
    assert(result.mediaType === 'application/json', `expected application/json, got ${result.mediaType}`);
  });

  await test('getRequestBodyFromFile auto-detects mime type', async () => {
    const result = WasapiClient.getRequestBodyFromFile('package.json');
    assert(result.mediaType === 'application/json', `expected auto-detected application/json, got ${result.mediaType}`);
  });

  // ── Summary ──
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
