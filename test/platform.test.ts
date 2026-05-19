import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as setImmediatePromise } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_NAME } from '../src/settings.js';

interface ClientOptionsCapture {
  baseUrl: string;
  userid: string;
  password: string;
  initialUserKeyValu?: string;
  pushRegistrationToken?: string;
  onTokenUpdate?: (token: string) => void;
}

const { clientCtorCalls, loginMock, getDeviceListMock } = vi.hoisted(() => ({
  clientCtorCalls: [] as ClientOptionsCapture[],
  loginMock: vi.fn(),
  getDeviceListMock: vi.fn(),
}));

vi.mock('../src/api/client.js', () => ({
  HiotClient: vi.fn().mockImplementation((options: ClientOptionsCapture) => {
    clientCtorCalls.push(options);
    return {
      login: loginMock,
      getDeviceList: getDeviceListMock,
    };
  }),
}));

import { HiotPlatform } from '../src/platform.js';
import { TokenStore } from '../src/storage/tokenStore.js';

let storageDir: string;

interface FakeLogger {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
}

interface FakeApi {
  on: ReturnType<typeof vi.fn>;
  user: { storagePath: () => string };
  hap: Record<string, unknown>;
  platformAccessory: ReturnType<typeof vi.fn>;
  registerPlatformAccessories: ReturnType<typeof vi.fn>;
  unregisterPlatformAccessories: ReturnType<typeof vi.fn>;
}

function makeFakes(configOverrides: Record<string, unknown> = {}): {
  log: FakeLogger;
  api: FakeApi;
  config: Record<string, unknown>;
} {
  const log: FakeLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  };
  const api: FakeApi = {
    on: vi.fn(),
    user: { storagePath: () => storageDir },
    hap: {},
    platformAccessory: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  };
  const config = {
    platform: PLATFORM_NAME,
    userid: 'u',
    password: 'p',
    ...configOverrides,
  };
  return { log, api, config };
}

function makePlatform(
  configOverrides: Record<string, unknown> = {},
): { platform: HiotPlatform; log: FakeLogger; api: FakeApi } {
  const { log, api, config } = makeFakes(configOverrides);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = new HiotPlatform(log as any, config as any, api as any);
  return { platform, log, api };
}

function flatten(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
}

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'hiot-platform-test-'));
  clientCtorCalls.length = 0;
  loginMock.mockReset();
  getDeviceListMock.mockReset();
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

describe('HiotPlatform', () => {
  it('constructs without throwing', () => {
    expect(() => makePlatform()).not.toThrow();
  });

  it('registers didFinishLaunching handler on the API', () => {
    const { api } = makePlatform();
    expect(api.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
  });

  it('configureAccessory stores the accessory without throwing', () => {
    const { platform } = makePlatform();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessory = { displayName: 'x', UUID: 'uuid', context: {} } as any;
    expect(() => platform.configureAccessory(accessory)).not.toThrow();
    expect(platform.accessories).toContain(accessory);
  });

  it('warns and skips bootstrap when userid is missing', async () => {
    const { platform, log } = makePlatform({ userid: undefined });
    await platform.handleDidFinishLaunching();

    expect(log.warn).toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
    expect(getDeviceListMock).not.toHaveBeenCalled();
    expect(clientCtorCalls).toHaveLength(0);
  });

  it('warns and skips bootstrap when password is missing', async () => {
    const { platform, log } = makePlatform({ password: undefined });
    await platform.handleDidFinishLaunching();

    expect(log.warn).toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
    expect(clientCtorCalls).toHaveLength(0);
  });

  it('didFinishLaunching calls login() then getDeviceList() and logs device count only', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_SECRET_1', devicetypecd: 'LGT', devicenm: 'living' },
        { devicecd: 'WSK_SECRET_2', devicetypecd: 'WSK', devicenm: 'kitchen' },
      ],
    });
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(getDeviceListMock).toHaveBeenCalledTimes(1);

    const infoText = log.info.mock.calls.map(flatten).join('\n');
    expect(infoText).toMatch(/2/);
    expect(infoText).not.toContain('LGT_SECRET_1');
    expect(infoText).not.toContain('WSK_SECRET_2');
    expect(infoText).not.toContain('living');
    expect(infoText).not.toContain('kitchen');
  });

  it('passes stored token as initialUserKeyValu to HiotClient', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    await new TokenStore(storageDir).save('STORED_TOKEN');

    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(clientCtorCalls).toHaveLength(1);
    expect(clientCtorCalls[0].initialUserKeyValu).toBe('STORED_TOKEN');
    expect(clientCtorCalls[0].userid).toBe('u');
    expect(clientCtorCalls[0].password).toBe('p');
    expect(clientCtorCalls[0].baseUrl).toBe('https://home.hiot.autoever.com:8443');
  });

  it('uses configured baseUrl and pushRegistrationToken when present', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform({
      baseUrl: 'https://example.test:9443',
      pushRegistrationToken: 'fcm-tok',
    });
    await platform.handleDidFinishLaunching();

    expect(clientCtorCalls[0].baseUrl).toBe('https://example.test:9443');
    expect(clientCtorCalls[0].pushRegistrationToken).toBe('fcm-tok');
  });

  it('persists token to disk when client invokes onTokenUpdate', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    const onTokenUpdate = clientCtorCalls[0].onTokenUpdate;
    expect(onTokenUpdate).toBeTypeOf('function');
    onTokenUpdate!('FRESH_TOKEN_FROM_LOGIN');

    const store = new TokenStore(storageDir);
    await vi.waitFor(async () => {
      expect(await store.load()).toBe('FRESH_TOKEN_FROM_LOGIN');
    });
  });

  it('logs error and does not throw when login fails', async () => {
    loginMock.mockRejectedValue(new Error('auth failed'));
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform, log } = makePlatform();

    await expect(platform.handleDidFinishLaunching()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
    expect(getDeviceListMock).not.toHaveBeenCalled();
  });

  it('didFinishLaunching callback registered via api.on does not throw or reject globally', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { api } = makePlatform();
    const call = api.on.mock.calls.find((c) => c[0] === 'didFinishLaunching');
    const handler = call![1] as () => void;
    expect(() => handler()).not.toThrow();
    // Drain microtasks to ensure the fire-and-forget promise settles.
    await setImmediatePromise();
    await setImmediatePromise();
  });

  it('never includes token or password in info/warn payloads', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    await new TokenStore(storageDir).save('SECRET_STORED_TOKEN');

    const { platform, log } = makePlatform({ password: 'SECRET_PASSWORD' });
    await platform.handleDidFinishLaunching();

    const onTokenUpdate = clientCtorCalls[0].onTokenUpdate;
    onTokenUpdate?.('ANOTHER_SECRET_TOKEN');
    await setImmediatePromise();

    const visible = [...log.info.mock.calls, ...log.warn.mock.calls].map(flatten).join('\n');
    expect(visible).not.toContain('SECRET_STORED_TOKEN');
    expect(visible).not.toContain('ANOTHER_SECRET_TOKEN');
    expect(visible).not.toContain('SECRET_PASSWORD');
  });
});
