import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThermostatAccessory } from '../../src/accessories/thermostat.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  Thermostat: { UUID: 'Service.Thermostat' },
  AccessoryInformation: { UUID: 'Service.AccessoryInformation' },
};

const HeatingCoolingState = { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 };

const CharId = {
  CurrentTemperature: { UUID: 'Characteristic.CurrentTemperature' },
  TargetTemperature: { UUID: 'Characteristic.TargetTemperature' },
  CurrentHeatingCoolingState: {
    UUID: 'Characteristic.CurrentHeatingCoolingState',
    ...HeatingCoolingState,
  },
  TargetHeatingCoolingState: {
    UUID: 'Characteristic.TargetHeatingCoolingState',
    ...HeatingCoolingState,
  },
  Manufacturer: { UUID: 'Characteristic.Manufacturer' },
  Model: { UUID: 'Characteristic.Model' },
  SerialNumber: { UUID: 'Characteristic.SerialNumber' },
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
    setProps: vi.fn().mockImplementation(function (this: CharStub) {
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
  devicecd: 'HTR_TEST_001',
  devicetypecd: 'HTR',
  devicenm: 'living-floor-test',
  spacenm: 'space-test',
};

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ ...CONTEXT });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new ThermostatAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.Thermostat)!;
  const currentTemp = svc.chars.get(CharId.CurrentTemperature)!;
  const targetTemp = svc.chars.get(CharId.TargetTemperature)!;
  const currentState = svc.chars.get(CharId.CurrentHeatingCoolingState)!;
  const targetState = svc.chars.get(CharId.TargetHeatingCoolingState)!;
  return { api, log, accessory, client, handler, svc, currentTemp, targetTemp, currentState, targetState };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThermostatAccessory', () => {
  it('adds Thermostat service and registers handlers for all four characteristics', () => {
    const { svc, currentTemp, targetTemp, currentState, targetState } = setup();
    expect(svc).toBeDefined();
    expect(currentTemp.onGet).toHaveBeenCalledTimes(1);
    expect(targetTemp.onGet).toHaveBeenCalledTimes(1);
    expect(targetTemp.onSet).toHaveBeenCalledTimes(1);
    expect(currentState.onGet).toHaveBeenCalledTimes(1);
    expect(targetState.onGet).toHaveBeenCalledTimes(1);
    expect(targetState.onSet).toHaveBeenCalledTimes(1);
  });

  it('sets AccessoryInformation Manufacturer / Model / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'HTR']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'HTR_TEST_001']);
  });

  it('reuses existing Thermostat service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ ...CONTEXT });
    const preexisting = makeService();
    accessory.services.set(ServiceId.Thermostat, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ThermostatAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.Thermostat);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.CurrentTemperature);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.TargetTemperature);
  });

  it('constrains TargetTemperature to 15-30 °C with 1° step', () => {
    const { targetTemp } = setup();
    expect(targetTemp.setProps).toHaveBeenCalledWith({ minValue: 15, maxValue: 30, minStep: 1 });
  });

  it('restricts TargetHeatingCoolingState valid values to OFF and HEAT', () => {
    const { targetState } = setup();
    expect(targetState.setProps).toHaveBeenCalledWith({
      validValues: [HeatingCoolingState.OFF, HeatingCoolingState.HEAT],
    });
  });

  it('CurrentTemperature onGet parses temperature[0].current as float', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockResolvedValue({
      temperature: [{ current: '22', desired: '24' }],
      operation: [{ power: 'on' }],
    });
    expect(await currentTemp.getHandler!()).toBe(22);
    expect(client.getDevice).toHaveBeenCalledWith('HTR_TEST_001');
  });

  it('TargetTemperature onGet parses temperature[0].desired as float', async () => {
    const { targetTemp, client } = setup();
    client.getDevice.mockResolvedValue({
      temperature: [{ current: '22', desired: '24' }],
      operation: [{ power: 'on' }],
    });
    expect(await targetTemp.getHandler!()).toBe(24);
  });

  it('CurrentHeatingCoolingState onGet returns HEAT when power=on', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    expect(await currentState.getHandler!()).toBe(HeatingCoolingState.HEAT);
  });

  it('CurrentHeatingCoolingState onGet returns OFF when power=off', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'off' }] });
    expect(await currentState.getHandler!()).toBe(HeatingCoolingState.OFF);
  });

  it('TargetHeatingCoolingState onGet returns HEAT/OFF mirroring power', async () => {
    const { targetState, client } = setup();
    client.getDevice.mockResolvedValueOnce({ operation: [{ power: 'on' }] });
    expect(await targetState.getHandler!()).toBe(HeatingCoolingState.HEAT);
    client.getDevice.mockResolvedValueOnce({ operation: [{ power: 'off' }] });
    expect(await targetState.getHandler!()).toBe(HeatingCoolingState.OFF);
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING when temperature array missing', async () => {
    const { currentTemp, client, log } = setup();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(currentTemp.getHandler!()).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING when current field is not numeric', async () => {
    const { currentTemp, client } = setup();
    client.getDevice.mockResolvedValue({ temperature: [{ current: 'oops' }] });
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('CurrentHeatingCoolingState onGet throws when power field missing', async () => {
    const { currentState, client } = setup();
    client.getDevice.mockResolvedValue({ operation: [{}] });
    await expect(currentState.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
  });

  it('CurrentTemperature onGet throws NOT_RESPONDING when API fails', async () => {
    const { currentTemp, client, log } = setup();
    client.getDevice.mockRejectedValue(new Error('boom'));
    await expect(currentTemp.getHandler!()).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('TargetTemperature onSet issues exeDeviceBatch with rounded integer string', async () => {
    const { targetTemp, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await targetTemp.setHandler!(22.7);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'HTR_TEST_001', resource: 'temperature', attribute: 'desired', value: '23' },
    ]);
  });

  it('TargetTemperature onSet throws NOT_RESPONDING when fail > 0', async () => {
    const { targetTemp, client, log } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 0, fail: 1 }] });
    await expect(targetTemp.setHandler!(22)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('TargetTemperature onSet throws NOT_RESPONDING when API call fails', async () => {
    const { targetTemp, client, log } = setup();
    client.exeDeviceBatch.mockRejectedValue(new Error('network'));
    await expect(targetTemp.setHandler!(22)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(log.warn).toHaveBeenCalled();
  });

  it('TargetHeatingCoolingState onSet(HEAT) sets operation power=on', async () => {
    const { targetState, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await targetState.setHandler!(HeatingCoolingState.HEAT);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'HTR_TEST_001', resource: 'operation', attribute: 'power', value: 'on' },
    ]);
  });

  it('TargetHeatingCoolingState onSet(OFF) sets operation power=off', async () => {
    const { targetState, client } = setup();
    client.exeDeviceBatch.mockResolvedValue({ device: [{ all: 1, success: 1, fail: 0 }] });

    await targetState.setHandler!(HeatingCoolingState.OFF);

    expect(client.exeDeviceBatch).toHaveBeenCalledWith([
      { devicecd: 'HTR_TEST_001', resource: 'operation', attribute: 'power', value: 'off' },
    ]);
  });

  it('TargetHeatingCoolingState onSet rejects COOL/AUTO modes', async () => {
    const { targetState, client, log } = setup();
    await expect(targetState.setHandler!(HeatingCoolingState.COOL)).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(targetState.setHandler!(HeatingCoolingState.AUTO)).rejects.toBeInstanceOf(FakeHapStatusError);
    expect(client.exeDeviceBatch).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not log devicecd or devicenm at info level', () => {
    const { log } = setup();
    const visible = log.info.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('HTR_TEST_001');
    expect(visible).not.toContain('living-floor-test');
  });
});
