import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LockAccessory } from '../../src/accessories/lock.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  LockMechanism: { UUID: 'Service.LockMechanism' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const LockState = { UNSECURED: 0, SECURED: 1, JAMMED: 2, UNKNOWN: 3 };

const CharId = {
  LockCurrentState: { UUID: 'Characteristic.LockCurrentState', ...LockState },
  LockTargetState: { UUID: 'Characteristic.LockTargetState', ...LockState },
  Manufacturer: { UUID: 'Characteristic.Manufacturer' },
  Model: { UUID: 'Characteristic.Model' },
  SerialNumber: { UUID: 'Characteristic.SerialNumber' },
  Name: { UUID: 'Characteristic.Name' },
};

const HAPStatus = {
  SERVICE_COMMUNICATION_FAILURE: -70402,
};

class FakeHapStatusError extends Error {
  hapStatus: number;
  constructor(status: number) {
    super(`HAP ${status}`);
    this.hapStatus = status;
  }
}

interface CharStub {
  onGet: ReturnType<typeof vi.fn>;
  onSet: ReturnType<typeof vi.fn>;
  getHandler?: () => unknown;
  setHandler?: (v: unknown) => unknown;
}

interface ServiceStub {
  setCharacteristic: ReturnType<typeof vi.fn>;
  getCharacteristic: ReturnType<typeof vi.fn>;
  chars: Map<unknown, CharStub>;
}

function makeChar(): CharStub {
  const c: CharStub = {
    onGet: vi.fn().mockImplementation(function (this: CharStub, fn: () => unknown) {
      c.getHandler = fn;
      return c;
    }),
    onSet: vi.fn().mockImplementation(function (this: CharStub, fn: (v: unknown) => unknown) {
      c.setHandler = fn;
      return c;
    }),
  };
  return c;
}

function makeService(): ServiceStub {
  const chars = new Map<unknown, CharStub>();
  const svc: ServiceStub = {
    chars,
    setCharacteristic: vi.fn().mockImplementation(function (this: ServiceStub) {
      return svc;
    }),
    getCharacteristic: vi.fn().mockImplementation((id: unknown) => {
      let c = chars.get(id);
      if (!c) {
        c = makeChar();
        chars.set(id, c);
      }
      return c;
    }),
  };
  return svc;
}

interface AccessoryStub {
  context: Record<string, unknown>;
  displayName: string;
  UUID: string;
  services: Map<unknown, ServiceStub>;
  getService: ReturnType<typeof vi.fn>;
  addService: ReturnType<typeof vi.fn>;
}

function makeAccessory(context: Record<string, unknown>): AccessoryStub {
  const services = new Map<unknown, ServiceStub>();
  const acc: AccessoryStub = {
    context,
    displayName: String(context.devicenm ?? ''),
    UUID: `UUID:${context.devicecd}`,
    services,
    getService: vi.fn().mockImplementation((id: unknown) => services.get(id)),
    addService: vi.fn().mockImplementation((id: unknown) => {
      const s = makeService();
      services.set(id, s);
      return s;
    }),
  };
  return acc;
}

function makeApi() {
  return {
    hap: {
      Service: ServiceId,
      Characteristic: CharId,
      HAPStatus,
      HapStatusError: FakeHapStatusError,
    },
  };
}

function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  };
}

interface ClientStub {
  getDevice: ReturnType<typeof vi.fn>;
  exeDeviceBatch: ReturnType<typeof vi.fn>;
}

function makeClient(): ClientStub {
  return {
    getDevice: vi.fn(),
    exeDeviceBatch: vi.fn(),
  };
}

const CONTEXT = {
  devicecd: 'GDK_TEST_001',
  devicetypecd: 'GDK',
  devicenm: 'gas-valve-test',
  spacenm: 'kitchen-test',
};

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new LockAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.LockMechanism)!;
  const current = svc.chars.get(CharId.LockCurrentState)!;
  const target = svc.chars.get(CharId.LockTargetState)!;
  return { api, log, accessory, client, handler, svc, current, target };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LockAccessory', () => {
  it('adds LockMechanism service and registers handlers for current/target states', () => {
    const { svc, current, target } = setup();
    expect(svc).toBeDefined();
    expect(current.onGet).toHaveBeenCalledTimes(1);
    expect(target.onGet).toHaveBeenCalledTimes(1);
    expect(target.onSet).toHaveBeenCalledTimes(1);
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'GDK']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'GDK_TEST_001']);
  });

  it('reuses existing LockMechanism service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    const preexisting = makeService();
    accessory.services.set(ServiceId.LockMechanism, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new LockAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.LockMechanism);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.LockCurrentState);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.LockTargetState);
  });

  it('LockCurrentState onGet returns SECURED when valve lock is "on"', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ valve: [{ lock: 'on' }] });

    expect(await current.getHandler!()).toBe(LockState.SECURED);
    expect(client.getDevice).toHaveBeenCalledWith('GDK_TEST_001');
  });

  it('LockCurrentState onGet returns UNSECURED when valve lock is "off"', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ valve: [{ lock: 'off' }] });
    expect(await current.getHandler!()).toBe(LockState.UNSECURED);
  });

  it('LockTargetState onGet mirrors valve lock value', async () => {
    const { target, client } = setup();
    client.getDevice.mockResolvedValueOnce({ valve: [{ lock: 'on' }] });
    expect(await target.getHandler!()).toBe(LockState.SECURED);
    client.getDevice.mockResolvedValueOnce({ valve: [{ lock: 'off' }] });
    expect(await target.getHandler!()).toBe(LockState.UNSECURED);
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when valve array missing', async () => {
    const { current, client, log } = setup();
    client.getDevice.mockResolvedValue({});
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(current.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when lock field is missing', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ valve: [{}] });
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when lock field is unexpected value', async () => {
    const { current, client, log } = setup();
    client.getDevice.mockResolvedValue({ valve: [{ lock: 'partial' }] });
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when API call fails', async () => {
    const { current, client, log } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockTargetState onSet(SECURED) issues exeDeviceBatch with valve/lock/"on"', async () => {
    const { target, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await target.setHandler!(LockState.SECURED);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'GDK_TEST_001', resource: 'valve', attribute: 'lock', value: 'on' },
    ]);
  });

  it('LockTargetState onSet(UNSECURED) issues exeDeviceBatch with valve/lock/"off"', async () => {
    const { target, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await target.setHandler!(LockState.UNSECURED);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'GDK_TEST_001', resource: 'valve', attribute: 'lock', value: 'off' },
    ]);
  });

  it('LockTargetState onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { target, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });

    await expect(target.setHandler!(LockState.SECURED)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockTargetState onSet throws NOT_RESPONDING when API call fails', async () => {
    const { target, client, log } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('network'));
    await expect(target.setHandler!(LockState.SECURED)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('GDK_TEST_001');
    expect(visible).not.toContain('gas-valve-test');
  });
});
