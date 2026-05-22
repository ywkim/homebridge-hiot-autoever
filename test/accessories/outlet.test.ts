import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OutletAccessory } from '../../src/accessories/outlet.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  Outlet: { UUID: 'Service.Outlet' },
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
  devicecd: 'WSK_TEST_001',
  devicetypecd: 'WSK',
  devicenm: 'outlet-test',
  spacenm: 'space-test',
};

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new OutletAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.Outlet)!;
  const on = svc.chars.get(CharId.On)!;
  return { api, log, accessory, client, handler, svc, on };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutletAccessory', () => {
  it('adds Outlet service and registers On characteristic handlers', () => {
    const { svc, on } = setup();
    expect(svc).toBeDefined();
    expect(on.onGet).toHaveBeenCalledTimes(1);
    expect(on.onSet).toHaveBeenCalledTimes(1);
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'WSK']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'WSK_TEST_001']);
  });

  it('reuses existing Outlet service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    // Pre-attach an Outlet service on the cached accessory.
    const preexisting = makeService();
    accessory.services.set(ServiceId.Outlet, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new OutletAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.Outlet);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.On);
  });

  it('onGet returns true when device power is "on"', async () => {
    const { on, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    const result = await on.getHandler!();
    expect(result).toBe(true);
    expect(client.getDevice).toHaveBeenCalledWith('WSK_TEST_001');
  });

  it('onGet returns false when device power is "off"', async () => {
    const { on, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await on.getHandler!()).toBe(false);
  });

  it('onGet throws NOT_RESPONDING when operation is missing', async () => {
    const { on, client, log } = setup();
    client.getDevice.mockResolvedValue({});
    await expect(on.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(on.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('onGet throws NOT_RESPONDING when power field is missing', async () => {
    const { on, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{}] });
    await expect(on.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('onGet throws HapStatusError NOT_RESPONDING when API call fails', async () => {
    const { on, client, log } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));

    await expect(on.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(on.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('onSet(true) issues exeDeviceBatch with value "on"', async () => {
    const { on, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await on.setHandler!(true);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'WSK_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('onSet(false) issues exeDeviceBatch with value "off"', async () => {
    const { on, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await on.setHandler!(false);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'WSK_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
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
    expect(visible).not.toContain('WSK_TEST_001');
    expect(visible).not.toContain('outlet-test');
  });
});
