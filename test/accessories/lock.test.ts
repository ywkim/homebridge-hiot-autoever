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
  setProps: ReturnType<typeof vi.fn>;
  setHandler?: (v: unknown) => unknown;
  props?: Record<string, unknown>;
}

interface ServiceStub {
  setCharacteristic: ReturnType<typeof vi.fn>;
  getCharacteristic: ReturnType<typeof vi.fn>;
  updateCharacteristic: ReturnType<typeof vi.fn>;
  chars: Map<unknown, CharStub>;
}

function makeChar(): CharStub {
  const c: CharStub = {
    onGet: vi.fn().mockImplementation(function (this: CharStub) {
      return c;
    }),
    onSet: vi.fn().mockImplementation(function (this: CharStub, fn: (v: unknown) => unknown) {
      c.setHandler = fn;
      return c;
    }),
    setProps: vi.fn().mockImplementation(function (this: CharStub, p: Record<string, unknown>) {
      c.props = { ...(c.props ?? {}), ...p };
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
    updateCharacteristic: vi.fn().mockImplementation(function (this: ServiceStub) {
      return svc;
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
  exeDeviceBatch: ReturnType<typeof vi.fn>;
}

function makeClient(): ClientStub {
  return {
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
  const target = svc.chars.get(CharId.LockTargetState)!;
  return { api, log, accessory, client, handler, svc, target };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LockAccessory', () => {
  it('adds LockMechanism service, wires only LockTargetState onSet (no onGet, background-poll pattern)', () => {
    const { svc, target } = setup();
    expect(svc).toBeDefined();
    // LockCurrentState is never wired in the constructor (no onGet); poller pushes value.
    expect(svc.getCharacteristic).not.toHaveBeenCalledWith(CharId.LockCurrentState);
    expect(target.onGet).not.toHaveBeenCalled();
    expect(target.onSet).toHaveBeenCalledTimes(1);
  });

  it('exposes devicecd for the poller', () => {
    const { handler } = setup();
    expect(handler.devicecd).toBe('GDK_TEST_001');
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
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.LockTargetState);
  });

  it('LockTargetState restricts validValues to [SECURED] to disable unlock UI', () => {
    const { target } = setup();
    expect(target.setProps).toHaveBeenCalledWith({ validValues: [LockState.SECURED] });
  });

  it('updateState pushes Current=SECURED + Target=SECURED when valve lock is "off"', () => {
    const { handler, svc } = setup();
    handler.updateState({ valve: [{ lock: 'off' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.LockCurrentState, LockState.SECURED);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.LockTargetState, LockState.SECURED);
  });

  it('updateState pushes Current=UNSECURED but Target stays SECURED when valve lock is "on" (validValues constraint)', () => {
    const { handler, svc } = setup();
    handler.updateState({ valve: [{ lock: 'on' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.LockCurrentState, LockState.UNSECURED);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.LockTargetState, LockState.SECURED);
  });

  it('updateState marks Not Responding on both characteristics when valve array missing', () => {
    const { handler, svc, log } = setup();
    handler.updateState({});
    const errors = svc.updateCharacteristic.mock.calls.filter(([, v]) => v instanceof FakeHapStatusError);
    expect(errors.map(([c]) => c)).toEqual(
      expect.arrayContaining([CharId.LockCurrentState, CharId.LockTargetState]),
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('updateState marks Not Responding when lock field is unexpected value', () => {
    const { handler, svc, log } = setup();
    handler.updateState({ valve: [{ lock: 'partial' }] });
    const errors = svc.updateCharacteristic.mock.calls.filter(([, v]) => v instanceof FakeHapStatusError);
    expect(errors).toHaveLength(2);
    expect(log.warn).toHaveBeenCalled();
  });

  it('LockTargetState onSet(SECURED) issues exeDeviceBatch with valve/lock/"off"', async () => {
    const { target, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await target.setHandler!(LockState.SECURED);

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
