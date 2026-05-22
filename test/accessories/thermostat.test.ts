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
  const targetTemp = svc.chars.get(CharId.TargetTemperature)!;
  const targetState = svc.chars.get(CharId.TargetHeatingCoolingState)!;
  return { api, log, accessory, client, handler, svc, targetTemp, targetState };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThermostatAccessory', () => {
  it('adds Thermostat service; only TargetTemperature/TargetHeatingCoolingState are wired (background-poll pattern)', () => {
    const { svc, targetTemp, targetState } = setup();
    expect(svc).toBeDefined();
    // Current* characteristics are never wired in the constructor; the poller pushes values.
    expect(svc.getCharacteristic).not.toHaveBeenCalledWith(CharId.CurrentTemperature);
    expect(svc.getCharacteristic).not.toHaveBeenCalledWith(CharId.CurrentHeatingCoolingState);
    expect(targetTemp.onGet).not.toHaveBeenCalled();
    expect(targetTemp.onSet).toHaveBeenCalledTimes(1);
    expect(targetState.onGet).not.toHaveBeenCalled();
    expect(targetState.onSet).toHaveBeenCalledTimes(1);
  });

  it('exposes devicecd for the poller', () => {
    const { handler } = setup();
    expect(handler.devicecd).toBe('HTR_TEST_001');
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

  // --- updateState ----------------------------------------------------------

  it('updateState pushes parsed CurrentTemperature and TargetTemperature', () => {
    const { handler, svc } = setup();
    handler.updateState({
      temperature: [{ current: '22', desired: '24' }],
      operation: [{ power: 'on' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.CurrentTemperature, 22);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.TargetTemperature, 24);
  });

  it('updateState pushes HEAT for both states when power=on', () => {
    const { handler, svc } = setup();
    handler.updateState({
      temperature: [{ current: '22', desired: '24' }],
      operation: [{ power: 'on' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.CurrentHeatingCoolingState,
      HeatingCoolingState.HEAT,
    );
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.TargetHeatingCoolingState,
      HeatingCoolingState.HEAT,
    );
  });

  it('updateState pushes OFF for both states when power=off', () => {
    const { handler, svc } = setup();
    handler.updateState({
      temperature: [{ current: '22', desired: '24' }],
      operation: [{ power: 'off' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.CurrentHeatingCoolingState,
      HeatingCoolingState.OFF,
    );
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.TargetHeatingCoolingState,
      HeatingCoolingState.OFF,
    );
  });

  it('updateState marks CurrentTemperature Not Responding when temperature array missing', () => {
    const { handler, svc, log } = setup();
    handler.updateState({ operation: [{ power: 'on' }] });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toContain(CharId.CurrentTemperature);
    expect(log.warn).toHaveBeenCalled();
  });

  it('updateState marks CurrentTemperature Not Responding when current is not numeric', () => {
    const { handler, svc } = setup();
    handler.updateState({
      temperature: [{ current: 'oops', desired: '24' }],
      operation: [{ power: 'on' }],
    });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toContain(CharId.CurrentTemperature);
  });

  it('updateState marks heating-cooling states Not Responding when power missing', () => {
    const { handler, svc } = setup();
    handler.updateState({ temperature: [{ current: '22', desired: '24' }] });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toEqual(
      expect.arrayContaining([CharId.CurrentHeatingCoolingState, CharId.TargetHeatingCoolingState]),
    );
  });

  // --- onSet ---------------------------------------------------------------

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
