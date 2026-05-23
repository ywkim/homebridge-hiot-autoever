import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LightbulbAccessory } from '../../src/accessories/lightbulb.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  Lightbulb: { UUID: 'Service.Lightbulb' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const CharId = {
  On: { UUID: 'Characteristic.On' },
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
  devicecd: 'LGT_TEST_001',
  devicetypecd: 'LGT',
  devicenm: 'living-test',
  spacenm: 'space-test',
};

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new LightbulbAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.Lightbulb)!;
  const on = svc.chars.get(CharId.On)!;
  return { api, log, accessory, client, handler, svc, on };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LightbulbAccessory', () => {
  it('adds Lightbulb service and registers only onSet for On (no onGet, background-poll pattern)', () => {
    const { svc, on } = setup();
    expect(svc).toBeDefined();
    expect(on.onGet).not.toHaveBeenCalled();
    expect(on.onSet).toHaveBeenCalledTimes(1);
  });

  it('exposes devicecd for the poller', () => {
    const { handler } = setup();
    expect(handler.devicecd).toBe('LGT_TEST_001');
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'LGT']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'LGT_TEST_001']);
  });

  it('reuses existing Lightbulb service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    // Pre-attach a Lightbulb service on the cached accessory.
    const preexisting = makeService();
    accessory.services.set(ServiceId.Lightbulb, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new LightbulbAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.Lightbulb);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.On);
  });

  it('updateState pushes On=true when power is "on"', () => {
    const { handler, svc } = setup();
    handler.updateState({ operation: [{ power: 'on' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.On, true);
  });

  it('updateState pushes On=false when power is "off"', () => {
    const { handler, svc } = setup();
    handler.updateState({ operation: [{ power: 'off' }] });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.On, false);
  });

  it('updateState marks Not Responding when operation array missing', () => {
    const { handler, svc, log } = setup();
    handler.updateState({});
    const [char, value] = svc.updateCharacteristic.mock.calls.at(-1)!;
    expect(char).toBe(CharId.On);
    expect(value).toBeInstanceOf(FakeHapStatusError);
    expect(value.hapStatus).toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(log.warn).toHaveBeenCalled();
  });

  it('updateState marks Not Responding when power field missing', () => {
    const { handler, svc } = setup();
    handler.updateState({ operation: [{}] });
    const [, value] = svc.updateCharacteristic.mock.calls.at(-1)!;
    expect(value).toBeInstanceOf(FakeHapStatusError);
  });

  it('onSet(true) issues exeDeviceBatch with value "on"', async () => {
    const { on, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await on.setHandler!(true);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'LGT_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('onSet(false) issues exeDeviceBatch with value "off"', async () => {
    const { on, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await on.setHandler!(false);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'LGT_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
  });

  it('onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { on, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });

    await expect(on.setHandler!(true)).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(on.setHandler!(true)).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('onSet throws NOT_RESPONDING when API call fails', async () => {
    const { on, client, log } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('network'));

    await expect(on.setHandler!(true)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('LGT_TEST_001');
    expect(visible).not.toContain('living-test');
  });
});
