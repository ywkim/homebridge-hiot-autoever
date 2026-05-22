import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LockAccessory } from '../../src/accessories/lock.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  LockMechanism: { UUID: 'Service.LockMechanism' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const CharId = {
  LockCurrentState: { UUID: 'Characteristic.LockCurrentState' },
  LockTargetState: { UUID: 'Characteristic.LockTargetState' },
  Manufacturer: { UUID: 'Characteristic.Manufacturer' },
  Model: { UUID: 'Characteristic.Model' },
  SerialNumber: { UUID: 'Characteristic.SerialNumber' },
  Name: { UUID: 'Characteristic.Name' },
};

const LockCurrentStateEnum = {
  UNSECURED: 0,
  SECURED: 1,
  JAMMED: 2,
  UNKNOWN: 3,
};

const LockTargetStateEnum = {
  UNSECURED: 0,
  SECURED: 1,
};

const CharWithStatics = {
  ...CharId,
  LockCurrentState: Object.assign(
    function LockCurrentState() {
      /* ctor stub */
    },
    CharId.LockCurrentState,
    LockCurrentStateEnum,
  ),
  LockTargetState: Object.assign(
    function LockTargetState() {
      /* ctor stub */
    },
    CharId.LockTargetState,
    LockTargetStateEnum,
  ),
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
      Characteristic: CharWithStatics,
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
  devicenm: 'gasvalve-test',
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
  const current = svc.chars.get(CharWithStatics.LockCurrentState)!;
  const target = svc.chars.get(CharWithStatics.LockTargetState)!;
  return { api, log, accessory, client, handler, svc, current, target };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LockAccessory', () => {
  it('adds LockMechanism service and registers Lock characteristic handlers', () => {
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
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharWithStatics.LockCurrentState);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharWithStatics.LockTargetState);
  });

  it('LockCurrentState onGet returns SECURED when device power is "on"', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    const result = await current.getHandler!();
    expect(result).toBe(LockCurrentStateEnum.SECURED);
    expect(client.getDevice).toHaveBeenCalledWith('GDK_TEST_001');
  });

  it('LockCurrentState onGet returns UNSECURED when device power is "off"', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await current.getHandler!()).toBe(LockCurrentStateEnum.UNSECURED);
  });

  it('LockCurrentState onGet maps "lock" / "closed" to SECURED', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'lock' }] });
    expect(await current.getHandler!()).toBe(LockCurrentStateEnum.SECURED);
    client.getDevice.mockResolvedValue({ operation: [{ power: 'closed' }] });
    expect(await current.getHandler!()).toBe(LockCurrentStateEnum.SECURED);
  });

  it('LockCurrentState onGet maps "unlock" / "open" to UNSECURED', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'unlock' }] });
    expect(await current.getHandler!()).toBe(LockCurrentStateEnum.UNSECURED);
    client.getDevice.mockResolvedValue({ operation: [{ power: 'open' }] });
    expect(await current.getHandler!()).toBe(LockCurrentStateEnum.UNSECURED);
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when operation is missing', async () => {
    const { current, client, log } = setup();
    client.getDevice.mockResolvedValue({});
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(current.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockCurrentState onGet throws NOT_RESPONDING when power field is missing', async () => {
    const { current, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{}] });
    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('LockCurrentState onGet throws HapStatusError NOT_RESPONDING when API call fails', async () => {
    const { current, client, log } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));

    await expect(current.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(current.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockTargetState onGet mirrors LockCurrentState', async () => {
    const { target, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    expect(await target.getHandler!()).toBe(LockTargetStateEnum.SECURED);
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await target.getHandler!()).toBe(LockTargetStateEnum.UNSECURED);
  });

  it('LockTargetState onSet(SECURED) issues exeDeviceBatch with value "on"', async () => {
    const { target, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await target.setHandler!(LockTargetStateEnum.SECURED);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'GDK_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('LockTargetState onSet(UNSECURED) issues exeDeviceBatch with value "off" (no safety guard)', async () => {
    const { target, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await target.setHandler!(LockTargetStateEnum.UNSECURED);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'GDK_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
  });

  it('LockTargetState onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { target, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });

    await expect(target.setHandler!(LockTargetStateEnum.SECURED)).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(target.setHandler!(LockTargetStateEnum.SECURED)).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockTargetState onSet throws NOT_RESPONDING when API call fails', async () => {
    const { target, client, log } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('network'));

    await expect(target.setHandler!(LockTargetStateEnum.SECURED)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('GDK_TEST_001');
    expect(visible).not.toContain('gasvalve-test');
  });
});
