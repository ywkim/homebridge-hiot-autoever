import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAgent } from 'undici';
import type { MockInterceptor } from 'undici/types/mock-interceptor.js';

import { HiotClient } from '../../src/api/client.js';
import { HiotApiError, HiotAuthError, HiotConnectionError } from '../../src/api/errors.js';

const BASE_URL = 'https://home.test.local:8443';
const LOGIN_PATH = '/hiot-web/login/exelogin';

interface CapturedRequest {
  path: string;
  body: unknown;
  cookie?: string;
}

interface ReplySpec {
  statusCode: number;
  data?: string | object;
  responseOptions?: { headers?: Record<string, string | string[]> };
}

function extractCookie(headers: MockInterceptor.MockResponseCallbackOptions['headers']): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const h = headers as { get: (k: string) => string | null };
    return h.get('cookie') ?? undefined;
  }
  const rec = headers as Record<string, string>;
  return rec.cookie ?? rec.Cookie;
}

function captureFromHandler(captured: CapturedRequest[]) {
  return (path: string, replySpec: ReplySpec) =>
    (opts: MockInterceptor.MockResponseCallbackOptions) => {
      const rawBody = typeof opts.body === 'string' ? opts.body : '';
      captured.push({
        path,
        body: rawBody ? JSON.parse(rawBody) : null,
        cookie: extractCookie(opts.headers),
      });
      return replySpec;
    };
}

describe('HiotClient', () => {
  let agent: MockAgent;
  let captured: CapturedRequest[];

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    captured = [];
  });

  afterEach(async () => {
    await agent.close();
  });

  function newClient(overrides: Partial<ConstructorParameters<typeof HiotClient>[0]> = {}) {
    return new HiotClient({
      baseUrl: BASE_URL,
      userid: 'testuser',
      password: 'testpass',
      dispatcher: agent,
      ...overrides,
    });
  }

  function interceptOnce(path: string, replySpec: ReplySpec) {
    const pool = agent.get(BASE_URL);
    const handler = captureFromHandler(captured)(path, replySpec);
    pool.intercept({ path, method: 'POST' }).reply(handler);
  }

  function interceptOnceError(path: string, err: Error) {
    const pool = agent.get(BASE_URL);
    pool.intercept({ path, method: 'POST' }).replyWithError(err);
  }

  it('login without cached token sends passwordvalu (not userkeyvalu)', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'testuser', householdcd: 'X_1_1', userkeyvalu: 'TOKEN1' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=sess1; Path=/; HttpOnly' } },
    });

    const client = newClient();
    const res = await client.login();

    expect(captured).toHaveLength(1);
    const body = captured[0].body as { condition: Record<string, string> };
    expect(body.condition.userid).toBe('testuser');
    expect(body.condition.apptypecd).toBe('HIOT');
    expect(body.condition.mobiledeviceostype).toBe('ios');
    expect(body.condition.passwordvalu).toBe('testpass');
    expect(body.condition.userkeyvalu).toBeUndefined();
    expect(res.login[0].userkeyvalu).toBe('TOKEN1');
    expect(client.getUserKeyValu()).toBe('TOKEN1');
  });

  it('login with cached token sends userkeyvalu (not passwordvalu)', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'testuser', householdcd: 'X_1_1', userkeyvalu: 'TOKEN2' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=sess2; Path=/; HttpOnly' } },
    });

    const client = newClient({ initialUserKeyValu: 'CACHED' });
    await client.login();

    const body = captured[0].body as { condition: Record<string, string> };
    expect(body.condition.userkeyvalu).toBe('CACHED');
    expect(body.condition.passwordvalu).toBeUndefined();
  });

  it('login invokes onTokenUpdate with new userkeyvalu', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'testuser', householdcd: 'X_1_1', userkeyvalu: 'NEW_TOKEN' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=sess3; Path=/' } },
    });

    const onTokenUpdate = vi.fn();
    const client = newClient({ onTokenUpdate });
    await client.login();
    expect(onTokenUpdate).toHaveBeenCalledWith('NEW_TOKEN');
  });

  it('login passes pushregistrationtoken when provided', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'testuser', householdcd: 'X_1_1', userkeyvalu: 'T' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });

    const client = newClient({ pushRegistrationToken: 'fcm-xyz' });
    await client.login();
    const body = captured[0].body as { condition: Record<string, string> };
    expect(body.condition.pushregistrationtoken).toBe('fcm-xyz');
  });

  it('login throws HiotAuthError when response lacks userkeyvalu', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });

    const client = newClient();
    await expect(client.login()).rejects.toBeInstanceOf(HiotAuthError);
  });

  it('getDeviceList auto-authenticates and sends session cookie on the data call', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'TOKEN' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=session-abc; Path=/; HttpOnly' } },
    });
    interceptOnce('/hiot-web/device/getdevicelist', {
      statusCode: 200,
      data: { device: [{ devicecd: 'LGT_X', devicetypecd: 'LGT', devicenm: 'L1' }] },
    });

    const client = newClient();
    const res = await client.getDeviceList();

    expect(res.device).toHaveLength(1);
    expect(res.device[0].devicecd).toBe('LGT_X');
    const dataCall = captured.find((c) => c.path === '/hiot-web/device/getdevicelist');
    expect(dataCall?.cookie).toContain('JSESSIONID_HIOTWEB=session-abc');
  });

  it('getDevice sends {device:{devicecd}} body', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'T' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });
    interceptOnce('/hiot-web/device/getdevice', {
      statusCode: 200,
      data: { operation: [{ power: 'on' }], device: [{ devicecd: 'LGT_X' }] },
    });

    const client = newClient();
    const res = await client.getDevice('LGT_X');
    const dataCall = captured.find((c) => c.path === '/hiot-web/device/getdevice');
    expect((dataCall?.body as { device: { devicecd: string } }).device.devicecd).toBe('LGT_X');
    expect(res.operation?.[0].power).toBe('on');
  });

  it('exeDeviceBatch sends commands array verbatim', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'T' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });
    interceptOnce('/hiot-web/device/exedevicebatchv2', {
      statusCode: 200,
      data: { message: [], device: [{ all: 1, success: 1, fail: 0 }] },
    });

    const client = newClient();
    const res = await client.exeDeviceBatch([
      { devicecd: 'LGT_X', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
    const dataCall = captured.find((c) => c.path === '/hiot-web/device/exedevicebatchv2');
    expect(dataCall?.body).toEqual({
      device: [{ devicecd: 'LGT_X', resource: 'operation', attribute: 'power', value: 'off' }],
    });
    expect(res.device[0].success).toBe(1);
  });

  it('401 on data call triggers plaintext re-login and retry', async () => {
    // first login (uses cached token)
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'OLD' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=stale; Path=/' } },
    });
    // getDeviceList #1 → 401
    interceptOnce('/hiot-web/device/getdevicelist', { statusCode: 401, data: { error: 'unauthorized' } });
    // re-login with plaintext
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'FRESH' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=fresh; Path=/' } },
    });
    // getDeviceList #2 → success
    interceptOnce('/hiot-web/device/getdevicelist', {
      statusCode: 200,
      data: { device: [{ devicecd: 'LGT_Z', devicetypecd: 'LGT', devicenm: 'Z' }] },
    });

    const client = newClient({ initialUserKeyValu: 'OLD' });
    const res = await client.getDeviceList();

    expect(res.device[0].devicecd).toBe('LGT_Z');
    expect(client.getUserKeyValu()).toBe('FRESH');

    const logins = captured.filter((c) => c.path === LOGIN_PATH).map((c) => c.body as { condition: Record<string, string> });
    expect(logins).toHaveLength(2);
    expect(logins[0].condition.userkeyvalu).toBe('OLD');
    expect(logins[1].condition.passwordvalu).toBe('testpass');
    expect(logins[1].condition.userkeyvalu).toBeUndefined();
  });

  it('non-401 HTTP error propagates as HiotApiError (not HiotAuthError) and does NOT embed response body in message', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'T' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });
    interceptOnce('/hiot-web/device/getdevicelist', { statusCode: 500, data: 'SENSITIVE_BODY_FRAGMENT' });

    const client = newClient();
    let caught: unknown;
    try {
      await client.getDeviceList();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HiotApiError);
    expect(caught).not.toBeInstanceOf(HiotAuthError);
    expect((caught as Error).message).not.toContain('SENSITIVE_BODY_FRAGMENT');
    // body still available via cause for debugging
    expect((caught as { cause?: unknown }).cause).toBe('SENSITIVE_BODY_FRAGMENT');
  });

  it('throws on empty response body instead of returning empty object', async () => {
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'T' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=s; Path=/' } },
    });
    interceptOnce('/hiot-web/device/getdevicelist', { statusCode: 200, data: '' });

    const client = newClient();
    await expect(client.getDeviceList()).rejects.toBeInstanceOf(HiotApiError);
  });

  it('coalesces concurrent login attempts into a single network request', async () => {
    let loginHits = 0;
    const pool = agent.get(BASE_URL);
    pool
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(() => {
        loginHits++;
        return {
          statusCode: 200,
          data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'TOK' }], complex: [] },
          responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=race; Path=/' } },
        };
      })
      .times(5);
    pool
      .intercept({ path: '/hiot-web/device/getdevicelist', method: 'POST' })
      .reply(200, { device: [] })
      .times(5);

    const client = newClient();
    await Promise.all([
      client.getDeviceList(),
      client.getDeviceList(),
      client.getDeviceList(),
      client.getDeviceList(),
      client.getDeviceList(),
    ]);
    expect(loginHits).toBe(1);
  });

  it('network failure wraps as HiotConnectionError', async () => {
    interceptOnceError(LOGIN_PATH, new Error('ECONNRESET'));

    const client = newClient();
    await expect(client.login()).rejects.toBeInstanceOf(HiotConnectionError);
  });

  it('does not log password / userkeyvalu / JSESSIONID values', async () => {
    // initial login with cached token (will be rejected by 401 path? no — initial login succeeds, then data 401 triggers re-login)
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'SECRET_TOKEN_VALUE' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=SECRET_SESSION_VALUE; Path=/' } },
    });
    interceptOnce('/hiot-web/device/getdevicelist', { statusCode: 401, data: '' });
    interceptOnce(LOGIN_PATH, {
      statusCode: 200,
      data: { login: [{ userid: 'u', householdcd: 'h', userkeyvalu: 'SECRET_TOKEN_VALUE' }], complex: [] },
      responseOptions: { headers: { 'set-cookie': 'JSESSIONID_HIOTWEB=SECRET_SESSION_VALUE; Path=/' } },
    });
    interceptOnce('/hiot-web/device/getdevicelist', { statusCode: 200, data: { device: [] } });

    const logs: string[] = [];
    const logger = {
      debug: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(m),
      error: (m: string) => logs.push(m),
    };
    const client = newClient({
      password: 'PLAINTEXT_PASSWORD_VALUE',
      initialUserKeyValu: 'SECRET_TOKEN_VALUE',
      logger,
    });
    await client.getDeviceList();

    const joined = logs.join('\n');
    expect(joined).not.toContain('SECRET_TOKEN_VALUE');
    expect(joined).not.toContain('SECRET_SESSION_VALUE');
    expect(joined).not.toContain('PLAINTEXT_PASSWORD_VALUE');
  });
});
