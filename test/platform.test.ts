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

interface PollerCtorCapture {
  intervalMs: number;
}

const {
  clientCtorCalls,
  loginMock,
  getDeviceListMock,
  lightbulbCtorCalls,
  thermostatCtorCalls,
  wskCtorCalls,
  elevatorCtorCalls,
  elevatorDisposeMock,
  pollerCtorCalls,
  pollerStartMock,
  pollerStopMock,
  pollerRegisterMock,
  pollerUnregisterMock,
} = vi.hoisted(() => ({
  clientCtorCalls: [] as ClientOptionsCapture[],
  loginMock: vi.fn(),
  getDeviceListMock: vi.fn(),
  lightbulbCtorCalls: [] as Array<{ devicecd: string; devicetypecd: string }>,
  thermostatCtorCalls: [] as Array<{ devicecd: string; devicetypecd: string }>,
  wskCtorCalls: [] as Array<{ devicecd: string }>,
  elevatorCtorCalls: [] as Array<{ uuid: string }>,
  elevatorDisposeMock: vi.fn(),
  pollerCtorCalls: [] as PollerCtorCapture[],
  pollerStartMock: vi.fn(),
  pollerStopMock: vi.fn(),
  pollerRegisterMock: vi.fn(),
  pollerUnregisterMock: vi.fn(),
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

vi.mock('../src/accessories/lightbulb.js', () => ({
  LightbulbAccessory: vi.fn().mockImplementation((_api, _log, accessory) => {
    const ctx = accessory.context as { devicecd: string; devicetypecd: string };
    lightbulbCtorCalls.push({ devicecd: ctx.devicecd, devicetypecd: ctx.devicetypecd });
    return { devicecd: ctx.devicecd, updateState: vi.fn() };
  }),
}));

vi.mock('../src/accessories/outlet.js', () => ({
  OutletAccessory: vi.fn().mockImplementation((_api, _log, accessory) => {
    const ctx = accessory.context as { devicecd: string };
    wskCtorCalls.push({ devicecd: ctx.devicecd });
    return { devicecd: ctx.devicecd, updateState: vi.fn() };
  }),
}));

vi.mock('../src/accessories/thermostat.js', () => ({
  ThermostatAccessory: vi.fn().mockImplementation((_api, _log, accessory) => {
    const ctx = accessory.context as { devicecd: string; devicetypecd: string };
    thermostatCtorCalls.push({ devicecd: ctx.devicecd, devicetypecd: ctx.devicetypecd });
    return { devicecd: ctx.devicecd, updateState: vi.fn() };
  }),
}));

vi.mock('../src/accessories/elevator.js', () => ({
  ElevatorAccessory: vi.fn().mockImplementation((_api, _log, accessory) => {
    elevatorCtorCalls.push({ uuid: (accessory as { UUID: string }).UUID });
    return { dispose: elevatorDisposeMock };
  }),
}));

vi.mock('../src/poller.js', () => ({
  HiotPoller: vi.fn().mockImplementation((_client, _log, intervalMs: number) => {
    pollerCtorCalls.push({ intervalMs });
    return {
      start: pollerStartMock,
      stop: pollerStopMock,
      register: pollerRegisterMock,
      unregister: pollerUnregisterMock,
    };
  }),
}));

import { HANDLER_REGISTRY, type AccessoryHandlerCtor } from '../src/accessories/registry.js';
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
    hap: {
      uuid: { generate: vi.fn((s: string) => `UUID:${s}`) },
    },
    platformAccessory: vi.fn().mockImplementation((displayName: string, uuid: string) => ({
      displayName,
      UUID: uuid,
      context: {} as Record<string, unknown>,
    })),
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
  lightbulbCtorCalls.length = 0;
  thermostatCtorCalls.length = 0;
  wskCtorCalls.length = 0;
  elevatorCtorCalls.length = 0;
  elevatorDisposeMock.mockReset();
  pollerCtorCalls.length = 0;
  loginMock.mockReset();
  getDeviceListMock.mockReset();
  pollerStartMock.mockReset();
  pollerStopMock.mockReset();
  pollerRegisterMock.mockReset();
  pollerUnregisterMock.mockReset();
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

  it('registers a new PlatformAccessory for each discovered device when cache is empty', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_20250103085844_AAA', devicetypecd: 'LGT', devicenm: '거실1', spacenm: '거실' },
        { devicecd: 'WSK_20250103085850_BBB', devicetypecd: 'WSK', devicenm: '거실2', spacenm: '거실' },
      ],
    });
    const { platform, api } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(api.platformAccessory).toHaveBeenCalledTimes(2);
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(2);

    const first = platform.accessories[0];
    expect(first.UUID).toBe('UUID:LGT_20250103085844_AAA');
    expect(first.displayName).toBe('거실1');
    expect(first.context).toEqual({
      devicecd: 'LGT_20250103085844_AAA',
      devicetypecd: 'LGT',
      devicenm: '거실1',
      spacenm: '거실',
    });
  });

  it('restores cached accessory and updates its context without re-registering', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: '새이름', spacenm: '거실' },
      ],
    });
    const { platform, api } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached: any = {
      displayName: '이전이름',
      UUID: 'UUID:LGT_AAA',
      context: { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: '이전이름' },
    };
    platform.configureAccessory(cached);

    await platform.handleDidFinishLaunching();

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(1);
    expect(cached.context).toEqual({
      devicecd: 'LGT_AAA',
      devicetypecd: 'LGT',
      devicenm: '새이름',
      spacenm: '거실',
    });
  });

  it('unregisters cached accessory when no longer present in device list', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform, api } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stale: any = {
      displayName: 'gone',
      UUID: 'UUID:GONE',
      context: { devicecd: 'GONE', devicetypecd: 'LGT', devicenm: 'gone' },
    };
    platform.configureAccessory(stale);

    await platform.handleDidFinishLaunching();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-hiot-autoever',
      PLATFORM_NAME,
      [stale],
    );
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(0);
  });

  it('handles mixed new + restored + removed in a single sync', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'KEEP_AAA', devicetypecd: 'LGT', devicenm: 'keep' },
        { devicecd: 'NEW_BBB', devicetypecd: 'WSK', devicenm: 'new' },
      ],
    });
    const { platform, api } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keep: any = {
      displayName: 'keep',
      UUID: 'UUID:KEEP_AAA',
      context: { devicecd: 'KEEP_AAA', devicetypecd: 'LGT', devicenm: 'keep' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gone: any = {
      displayName: 'gone',
      UUID: 'UUID:GONE_CCC',
      context: { devicecd: 'GONE_CCC', devicetypecd: 'LGT', devicenm: 'gone' },
    };
    platform.configureAccessory(keep);
    platform.configureAccessory(gone);

    await platform.handleDidFinishLaunching();

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-hiot-autoever',
      PLATFORM_NAME,
      [gone],
    );
    expect(platform.accessories).toContain(keep);
    expect(platform.accessories).not.toContain(gone);
    expect(platform.accessories).toHaveLength(2);
  });

  it('makes no register/unregister calls when device list and cache are both empty', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform, api } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories).toHaveLength(0);
  });

  it('does not attempt discovery when login fails', async () => {
    loginMock.mockRejectedValue(new Error('auth failed'));
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform, api } = makePlatform();

    await expect(platform.handleDidFinishLaunching()).resolves.toBeUndefined();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(api.platformAccessory).not.toHaveBeenCalled();
  });

  it('omits devicecd/devicenm from info-level discovery summary', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_SECRET_DEVICECD', devicetypecd: 'LGT', devicenm: 'SECRET_DEVICENM' },
      ],
    });
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    const infoText = log.info.mock.calls.map(flatten).join('\n');
    expect(infoText).toMatch(/1 device\(s\)/);
    expect(infoText).toMatch(/1 new/);
    expect(infoText).not.toContain('LGT_SECRET_DEVICECD');
    expect(infoText).not.toContain('SECRET_DEVICENM');
  });

  it('attaches LightbulbAccessory only for LGT devicetypecd', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' },
        { devicecd: 'LGT_BBB', devicetypecd: 'LGT', devicenm: 'l2' },
        { devicecd: 'WSK_CCC', devicetypecd: 'WSK', devicenm: 'w1' },
        { devicecd: 'HTR_DDD', devicetypecd: 'HTR', devicenm: 'h1' },
      ],
    });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(lightbulbCtorCalls.map((c) => c.devicecd).sort()).toEqual(['LGT_AAA', 'LGT_BBB']);
  });

  it('attaches LightbulbAccessory to restored LGT accessories from cache', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [{ devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' }],
    });
    const { platform, api } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached: any = {
      displayName: 'l1',
      UUID: 'UUID:LGT_AAA',
      context: { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' },
    };
    platform.configureAccessory(cached);

    await platform.handleDidFinishLaunching();

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(lightbulbCtorCalls).toHaveLength(1);
    expect(lightbulbCtorCalls[0].devicecd).toBe('LGT_AAA');
  });

  it('does not attach LightbulbAccessory twice for the same UUID', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [{ devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' }],
    });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();
    await platform.handleDidFinishLaunching();

    expect(lightbulbCtorCalls).toHaveLength(1);
  });

  it('logs handler attach summary grouped by devicetypecd at info level', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' },
        { devicecd: 'WSK_BBB', devicetypecd: 'WSK', devicenm: 'w1' },
      ],
    });
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    const infoText = log.info.mock.calls.map(flatten).join('\n');
    expect(infoText).toMatch(/handlers attached:\s*LGT=1/);
    expect(infoText).not.toContain('LGT_AAA');
  });

  it('logs "none" when no handler is attached', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [{ devicecd: 'UNKNOWN_BBB', devicetypecd: 'UNKNOWN', devicenm: 'u1' }],
    });
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    const infoText = log.info.mock.calls.map(flatten).join('\n');
    expect(infoText).toMatch(/handlers attached:\s*none/);
  });

  it('attaches handler for non-LGT type when registered in HANDLER_REGISTRY', async () => {
    const WSKStub = vi.fn().mockImplementation((_api, _log, accessory, _client) => {
      const ctx = accessory.context as { devicecd: string };
      wskCtorCalls.push({ devicecd: ctx.devicecd });
      return {};
    }) as unknown as AccessoryHandlerCtor;
    HANDLER_REGISTRY.WSK = WSKStub;
    try {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({
        device: [
          { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' },
          { devicecd: 'WSK_BBB', devicetypecd: 'WSK', devicenm: 'w1' },
          { devicecd: 'HTR_CCC', devicetypecd: 'HTR', devicenm: 'h1' },
        ],
      });
      const { platform, log } = makePlatform();
      await platform.handleDidFinishLaunching();

      expect(wskCtorCalls.map((c) => c.devicecd)).toEqual(['WSK_BBB']);
      expect(lightbulbCtorCalls.map((c) => c.devicecd)).toEqual(['LGT_AAA']);
      expect(thermostatCtorCalls.map((c) => c.devicecd)).toEqual(['HTR_CCC']);
      const infoText = log.info.mock.calls.map(flatten).join('\n');
      expect(infoText).toMatch(/handlers attached:.*LGT=1/);
      expect(infoText).toMatch(/handlers attached:.*WSK=1/);
      expect(infoText).toMatch(/handlers attached:.*HTR=1/);
    } finally {
      delete HANDLER_REGISTRY.WSK;
    }
  });

  it('constructs HiotPoller with default 30_000 ms when config omits pollingIntervalMs', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(pollerCtorCalls).toHaveLength(1);
    expect(pollerCtorCalls[0].intervalMs).toBe(30_000);
  });

  it('honors configured pollingIntervalMs', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform({ pollingIntervalMs: 15_000 });
    await platform.handleDidFinishLaunching();

    expect(pollerCtorCalls[0].intervalMs).toBe(15_000);
  });

  it('clamps pollingIntervalMs below the 5000 ms minimum', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform, log } = makePlatform({ pollingIntervalMs: 100 });
    await platform.handleDidFinishLaunching();

    expect(pollerCtorCalls[0].intervalMs).toBe(5_000);
    expect(log.warn).toHaveBeenCalled();
  });

  it('registers each attached handler with the poller and starts it', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({
      device: [
        { devicecd: 'LGT_AAA', devicetypecd: 'LGT', devicenm: 'l1' },
        { devicecd: 'HTR_BBB', devicetypecd: 'HTR', devicenm: 'h1' },
      ],
    });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(pollerRegisterMock).toHaveBeenCalledTimes(2);
    const registeredDevicecds = pollerRegisterMock.mock.calls.map(
      (c) => (c[1] as { devicecd: string }).devicecd,
    );
    expect(registeredDevicecds.sort()).toEqual(['HTR_BBB', 'LGT_AAA']);
    expect(pollerStartMock).toHaveBeenCalledTimes(1);
  });

  it('does not start the poller when bootstrap fails before device discovery', async () => {
    loginMock.mockRejectedValue(new Error('auth failed'));
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(pollerStartMock).not.toHaveBeenCalled();
  });

  it('logs the response body cause at debug level when bootstrap fails', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockRejectedValue(
      new Error('HTTP 500 on /hiot-web/device/getdevicelist', { cause: 'errorcode:platform.error.00001' }),
    );
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(log.error).toHaveBeenCalledWith('Hi-oT bootstrap failed: HTTP 500 on /hiot-web/device/getdevicelist');
    expect(log.debug).toHaveBeenCalledWith(
      'Hi-oT bootstrap failed: HTTP 500 on /hiot-web/device/getdevicelist: errorcode:platform.error.00001',
    );
  });

  it('logs the error cause message at debug level when bootstrap fails with an Error cause', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockRejectedValue(new Error('Connection failed', { cause: new Error('timeout') }));
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(log.error).toHaveBeenCalledWith('Hi-oT bootstrap failed: Connection failed');
    expect(log.debug).toHaveBeenCalledWith('Hi-oT bootstrap failed: Connection failed: timeout');
  });

  it('does not log a redundant debug line when bootstrap fails without a cause', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockRejectedValue(new Error('unexpected failure'));
    const { platform, log } = makePlatform();
    await platform.handleDidFinishLaunching();

    expect(log.error).toHaveBeenCalledWith('Hi-oT bootstrap failed: unexpected failure');
    expect(log.debug).not.toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
  });

  it('unregisters stale handler from the poller when a device disappears', async () => {
    loginMock.mockResolvedValue({});
    getDeviceListMock.mockResolvedValue({ device: [] });
    const { platform } = makePlatform();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stale: any = {
      displayName: 'gone',
      UUID: 'UUID:GONE',
      context: { devicecd: 'GONE', devicetypecd: 'LGT', devicenm: 'gone' },
    };
    platform.configureAccessory(stale);

    await platform.handleDidFinishLaunching();

    expect(pollerUnregisterMock).toHaveBeenCalledWith('UUID:GONE');
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

  describe('elevator (ELV) accessory', () => {
    it('does not register an elevator accessory when config.elevator is unset (opt-out)', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform, api } = makePlatform();
      await platform.handleDidFinishLaunching();

      expect(elevatorCtorCalls).toHaveLength(0);
      expect(api.platformAccessory).not.toHaveBeenCalledWith('엘리베이터 호출', 'UUID:ELV');
    });

    it('registers and attaches an elevator accessory when config.elevator is true', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform, api } = makePlatform({ elevator: true });
      await platform.handleDidFinishLaunching();

      expect(api.platformAccessory).toHaveBeenCalledWith('엘리베이터 호출', 'UUID:ELV');
      expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
      expect(elevatorCtorCalls).toEqual([{ uuid: 'UUID:ELV' }]);
      expect(platform.accessories.some((a) => a.UUID === 'UUID:ELV')).toBe(true);
    });

    it('restores a cached elevator accessory without re-registering when opt-in', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform, api } = makePlatform({ elevator: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cached: any = {
        displayName: '엘리베이터 호출',
        UUID: 'UUID:ELV',
        context: { kind: 'elevator' },
      };
      platform.configureAccessory(cached);

      await platform.handleDidFinishLaunching();

      expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
      expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
      expect(elevatorCtorCalls).toEqual([{ uuid: 'UUID:ELV' }]);
    });

    it('unregisters a cached elevator accessory when opt-out', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform, api } = makePlatform();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cached: any = {
        displayName: '엘리베이터 호출',
        UUID: 'UUID:ELV',
        context: { kind: 'elevator' },
      };
      platform.configureAccessory(cached);

      await platform.handleDidFinishLaunching();

      expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
      expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
        'homebridge-hiot-autoever',
        PLATFORM_NAME,
        [cached],
      );
      expect(elevatorCtorCalls).toHaveLength(0);
      expect(platform.accessories.some((a) => a.UUID === 'UUID:ELV')).toBe(false);
    });

    it('disposes the previous handler before re-instantiating on a repeat sync (idempotent)', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform } = makePlatform({ elevator: true });

      await platform.handleDidFinishLaunching();
      await platform.handleDidFinishLaunching();

      expect(elevatorCtorCalls).toHaveLength(2);
      expect(elevatorDisposeMock).toHaveBeenCalledTimes(1);
    });

    it('disposes a live elevator handler when the opt-out cleanup runs', () => {
      const { platform } = makePlatform();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internals = platform as any;
      internals.client = {};
      internals.elevatorHandler = { dispose: elevatorDisposeMock };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cached: any = {
        displayName: '엘리베이터 호출',
        UUID: 'UUID:ELV',
        context: { kind: 'elevator' },
      };
      platform.configureAccessory(cached);

      internals.syncElevator();

      expect(elevatorDisposeMock).toHaveBeenCalledTimes(1);
      expect(internals.elevatorHandler).toBeUndefined();
    });

    it('disposes the elevator handler on the shutdown event', async () => {
      loginMock.mockResolvedValue({});
      getDeviceListMock.mockResolvedValue({ device: [] });
      const { platform, api } = makePlatform({ elevator: true });
      await platform.handleDidFinishLaunching();

      const shutdown = api.on.mock.calls.find((c) => c[0] === 'shutdown');
      expect(shutdown).toBeDefined();
      (shutdown![1] as () => void)();
      expect(elevatorDisposeMock).toHaveBeenCalledTimes(1);
    });
  });
});
