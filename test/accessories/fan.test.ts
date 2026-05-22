import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FanAccessory } from '../../src/accessories/fan.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  Fanv2: { UUID: 'Service.Fanv2' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const CharId = {
  Active: { UUID: 'Characteristic.Active' },
  Manufacturer: { UUID: 'Characteristic.Manufacturer' },
  Model: { UUID: 'Characteristic.Model' },
  SerialNumber: { UUID: 'Characteristic.SerialNumber' },
  Name: { UUID: 'Characteristic.Name' },
};

const ActiveValue = {
  INACTIVE: 0,
  ACTIVE: 1,
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
  setHandler?: (v: unknown) => unknown;
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
      Characteristic: { ...CharId, Active: { ...CharId.Active, ...ActiveValue } },
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
  devicecd: 'VNT_TEST_001',
  devicetypecd: 'VNT',
  devicenm: 'vent-test',
  spacenm: 'space-test',
};

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new FanAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.Fanv2)!;
  const active = svc.chars.get(api.hap.Characteristic.Active)!;
  return { api, log, accessory, client, handler, svc, active };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FanAccessory', () => {
  it('adds Fanv2 service and registers only onSet for Active (no onGet, background-poll pattern)', () => {
    const { svc, active } = setup();
    expect(svc).toBeDefined();
    expect(active.onGet).not.toHaveBeenCalled();
    expect(active.onSet).toHaveBeenCalledTimes(1);
  });

  it('exposes devicecd for the poller', () => {
    const { handler } = setup();
    expect(handler.devicecd).toBe('VNT_TEST_001');
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'VNT']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'VNT_TEST_001']);
  });

  it('reuses existing Fanv2 service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    const preexisting = makeService();
    accessory.services.set(ServiceId.Fanv2, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new FanAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.Fanv2);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(api.hap.Characteristic.Active);
  });

  it('updateState pushes Active=ACTIVE when power is "on"', () => {
    const { handler, svc, api } = setup();
    handler.updateState({ operation: [{ power: 'on' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(api.hap.Characteristic.Active, ActiveValue.ACTIVE);
  });

  it('updateState pushes Active=INACTIVE when power is "off"', () => {
    const { handler, svc, api } = setup();
    handler.updateState({ operation: [{ power: 'off' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(api.hap.Characteristic.Active, ActiveValue.INACTIVE);
  });

  it('updateState marks Not Responding when operation array missing', () => {
    const { handler, svc, log } = setup();
    handler.updateState({});
    const [, value] = svc.updateCharacteristic.mock.calls.at(-1)!;
    expect(value).toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('updateState marks Not Responding when power field missing', () => {
    const { handler, svc } = setup();
    handler.updateState({ operation: [{}] });
    const [, value] = svc.updateCharacteristic.mock.calls.at(-1)!;
    expect(value).toBeInstanceOf(FakeHapStatusError);
  });

  it('onSet(ACTIVE) issues exeDeviceBatch with value "on"', async () => {
    const { active, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await active.setHandler!(ActiveValue.ACTIVE);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'VNT_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('onSet(INACTIVE) issues exeDeviceBatch with value "off"', async () => {
    const { active, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await active.setHandler!(ActiveValue.INACTIVE);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'VNT_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
  });

  it('onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { active, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });

    await expect(active.setHandler!(ActiveValue.ACTIVE)).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(active.setHandler!(ActiveValue.ACTIVE)).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('onSet throws NOT_RESPONDING when API call fails', async () => {
    const { active, client, log } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('network'));

    await expect(active.setHandler!(ActiveValue.ACTIVE)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('VNT_TEST_001');
    expect(visible).not.toContain('vent-test');
  });
});
