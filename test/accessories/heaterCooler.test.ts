import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaterCoolerAccessory } from '../../src/accessories/heaterCooler.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  HeaterCooler: { UUID: 'Service.HeaterCooler' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const CharId = {
  Active: { UUID: 'Characteristic.Active' },
  CurrentTemperature: { UUID: 'Characteristic.CurrentTemperature' },
  CurrentHeaterCoolerState: { UUID: 'Characteristic.CurrentHeaterCoolerState' },
  TargetHeaterCoolerState: { UUID: 'Characteristic.TargetHeaterCoolerState' },
  CoolingThresholdTemperature: { UUID: 'Characteristic.CoolingThresholdTemperature' },
  Manufacturer: { UUID: 'Characteristic.Manufacturer' },
  Model: { UUID: 'Characteristic.Model' },
  SerialNumber: { UUID: 'Characteristic.SerialNumber' },
  Name: { UUID: 'Characteristic.Name' },
};

const ActiveValue = { INACTIVE: 0, ACTIVE: 1 };
const CurrentHCState = { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 };
const TargetHCState = { AUTO: 0, HEAT: 1, COOL: 2 };

// Attach static enum-like values to the characteristic identity objects.
Object.assign(CharId.Active, ActiveValue);
Object.assign(CharId.CurrentHeaterCoolerState, CurrentHCState);
Object.assign(CharId.TargetHeaterCoolerState, TargetHCState);

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
  getHandler?: () => unknown;
  setHandler?: (v: unknown) => unknown;
  props?: Record<string, unknown>;
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
  devicecd: 'ACB_TEST_001',
  devicetypecd: 'ACB',
  devicenm: 'living-ac',
  spacenm: 'living',
};

interface SetupResult {
  api: ReturnType<typeof makeApi>;
  log: ReturnType<typeof makeLog>;
  accessory: AccessoryStub;
  client: ClientStub;
  handler: HeaterCoolerAccessory;
  svc: ServiceStub;
  active: CharStub;
  currentTemp: CharStub;
  currentState: CharStub;
  targetState: CharStub;
  coolThreshold: CharStub;
}

function setup(): SetupResult {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new HeaterCoolerAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.HeaterCooler)!;
  return {
    api,
    log,
    accessory,
    client,
    handler,
    svc,
    active: svc.chars.get(CharId.Active)!,
    currentTemp: svc.chars.get(CharId.CurrentTemperature)!,
    currentState: svc.chars.get(CharId.CurrentHeaterCoolerState)!,
    targetState: svc.chars.get(CharId.TargetHeaterCoolerState)!,
    coolThreshold: svc.chars.get(CharId.CoolingThresholdTemperature)!,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HeaterCoolerAccessory', () => {
  it('adds HeaterCooler service with the required characteristics', () => {
    const { svc, active, currentTemp, currentState, targetState, coolThreshold } = setup();
    expect(svc).toBeDefined();
    expect(active).toBeDefined();
    expect(currentTemp).toBeDefined();
    expect(currentState).toBeDefined();
    expect(targetState).toBeDefined();
    expect(coolThreshold).toBeDefined();
  });

  it('registers onGet/onSet for Active', () => {
    const { active } = setup();
    expect(active.onGet).toHaveBeenCalledTimes(1);
    expect(active.onSet).toHaveBeenCalledTimes(1);
  });

  it('registers onGet for CurrentTemperature', () => {
    const { currentTemp } = setup();
    expect(currentTemp.onGet).toHaveBeenCalledTimes(1);
  });

  it('registers onGet for CurrentHeaterCoolerState', () => {
    const { currentState } = setup();
    expect(currentState.onGet).toHaveBeenCalledTimes(1);
  });

  it('registers onGet/onSet for TargetHeaterCoolerState and limits validValues to [COOL]', () => {
    const { targetState } = setup();
    expect(targetState.onGet).toHaveBeenCalledTimes(1);
    expect(targetState.onSet).toHaveBeenCalledTimes(1);
    expect(targetState.setProps).toHaveBeenCalledWith({ validValues: [TargetHCState.COOL] });
  });

  it('registers onGet/onSet and props for CoolingThresholdTemperature', () => {
    const { coolThreshold } = setup();
    expect(coolThreshold.onGet).toHaveBeenCalledTimes(1);
    expect(coolThreshold.onSet).toHaveBeenCalledTimes(1);
    expect(coolThreshold.setProps).toHaveBeenCalledWith({
      minValue: 18,
      maxValue: 30,
      minStep: 1,
    });
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'ACB']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'ACB_TEST_001']);
  });

  it('reuses existing HeaterCooler service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    const preexisting = makeService();
    accessory.services.set(ServiceId.HeaterCooler, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new HeaterCoolerAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.HeaterCooler);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.Active);
  });

  // --- Active onGet ---------------------------------------------------------

  it('Active onGet returns ACTIVE when power is "on"', async () => {
    const { active, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    expect(await active.getHandler!()).toBe(ActiveValue.ACTIVE);
    expect(client.getDevice).toHaveBeenCalledWith('ACB_TEST_001');
  });

  it('Active onGet returns INACTIVE when power is "off"', async () => {
    const { active, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await active.getHandler!()).toBe(ActiveValue.INACTIVE);
  });

  it('Active onGet throws NOT_RESPONDING when power field is missing', async () => {
    const { active, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{}] });
    await expect(active.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('Active onGet throws NOT_RESPONDING when API call fails', async () => {
    const { active, client, log } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));
    await expect(active.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  // --- Active onSet ---------------------------------------------------------

  it('Active onSet(ACTIVE) issues power=on', async () => {
    const { active, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });
    await active.setHandler!(ActiveValue.ACTIVE);
    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'ACB_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('Active onSet(INACTIVE) issues power=off', async () => {
    const { active, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });
    await active.setHandler!(ActiveValue.INACTIVE);
    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'ACB_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
  });

  it('Active onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { active, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });
    await expect(active.setHandler!(ActiveValue.ACTIVE)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('Active onSet throws NOT_RESPONDING on network error', async () => {
    const { active, client } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('boom'));
    await expect(active.setHandler!(ActiveValue.ACTIVE)).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  // --- CurrentTemperature onGet --------------------------------------------

  it('CurrentTemperature onGet parses temperature[0].current', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockResolvedValue({ temperature: [{ current: '24.5', desired: '22' }] });
    expect(await currentTemp.getHandler!()).toBe(24.5);
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING when temperature missing', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockResolvedValue({});
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING when current is not numeric', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockResolvedValue({ temperature: [{ current: 'NaN-like' }] });
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING on API failure', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  // --- CurrentHeaterCoolerState onGet --------------------------------------

  it('CurrentHeaterCoolerState onGet returns COOLING when power is "on"', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    expect(await currentState.getHandler!()).toBe(CurrentHCState.COOLING);
  });

  it('CurrentHeaterCoolerState onGet returns INACTIVE when power is "off"', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await currentState.getHandler!()).toBe(CurrentHCState.INACTIVE);
  });

  it('CurrentHeaterCoolerState onGet throws NOT_RESPONDING when power missing', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({});
    await expect(currentState.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  // --- TargetHeaterCoolerState ---------------------------------------------

  it('TargetHeaterCoolerState onGet always returns COOL', async () => {
    const { targetState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    expect(await targetState.getHandler!()).toBe(TargetHCState.COOL);
  });

  it('TargetHeaterCoolerState onSet(COOL) is a no-op (no batch call)', async () => {
    const { targetState, client } = setup();
    await targetState.setHandler!(TargetHCState.COOL);
    expect(client.exeDeviceBatch).not.toHaveBeenCalled();
  });

  // --- CoolingThresholdTemperature -----------------------------------------

  it('CoolingThresholdTemperature onGet parses temperature[0].desired', async () => {
    const { coolThreshold, client } = setup();
    client.getDevice.mockResolvedValue({ temperature: [{ current: '24.5', desired: '22' }] });
    expect(await coolThreshold.getHandler!()).toBe(22);
  });

  it('CoolingThresholdTemperature onGet throws NOT_RESPONDING when desired missing', async () => {
    const { coolThreshold, client } = setup();
    client.getDevice.mockResolvedValue({ temperature: [{ current: '24.5' }] });
    await expect(coolThreshold.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('CoolingThresholdTemperature onSet sends integer-string desired', async () => {
    const { coolThreshold, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });
    await coolThreshold.setHandler!(23.7);
    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'ACB_TEST_001', resource: 'temperature', attribute: 'desired', value: '24' },
    ]);
  });

  it('CoolingThresholdTemperature onSet throws NOT_RESPONDING when batch reports fail > 0', async () => {
    const { coolThreshold, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });
    await expect(coolThreshold.setHandler!(25)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('CoolingThresholdTemperature onSet throws NOT_RESPONDING on network error', async () => {
    const { coolThreshold, client } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('boom'));
    await expect(coolThreshold.setHandler!(25)).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  // --- Privacy --------------------------------------------------------------

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('ACB_TEST_001');
    expect(visible).not.toContain('living-ac');
  });
});
