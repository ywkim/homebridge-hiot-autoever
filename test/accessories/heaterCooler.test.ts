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
    targetState: svc.chars.get(CharId.TargetHeaterCoolerState)!,
    coolThreshold: svc.chars.get(CharId.CoolingThresholdTemperature)!,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HeaterCoolerAccessory', () => {
  it('adds HeaterCooler service', () => {
    const { svc } = setup();
    expect(svc).toBeDefined();
  });

  it('exposes devicecd for the poller', () => {
    const { handler } = setup();
    expect(handler.devicecd).toBe('ACB_TEST_001');
  });

  it('registers onSet (and no onGet) for Active', () => {
    const { active } = setup();
    expect(active.onGet).not.toHaveBeenCalled();
    expect(active.onSet).toHaveBeenCalledTimes(1);
  });

  it('does not wire CurrentTemperature in constructor (background-poll only)', () => {
    const { svc } = setup();
    expect(svc.getCharacteristic).not.toHaveBeenCalledWith(CharId.CurrentTemperature);
  });

  it('does not wire CurrentHeaterCoolerState in constructor (background-poll only)', () => {
    const { svc } = setup();
    expect(svc.getCharacteristic).not.toHaveBeenCalledWith(CharId.CurrentHeaterCoolerState);
  });

  it('registers onSet (and no onGet) for TargetHeaterCoolerState and limits validValues to [COOL]', () => {
    const { targetState } = setup();
    expect(targetState.onGet).not.toHaveBeenCalled();
    expect(targetState.onSet).toHaveBeenCalledTimes(1);
    expect(targetState.setProps).toHaveBeenCalledWith({ validValues: [TargetHCState.COOL] });
  });

  it('registers onSet (and no onGet) and props for CoolingThresholdTemperature', () => {
    const { coolThreshold } = setup();
    expect(coolThreshold.onGet).not.toHaveBeenCalled();
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

  // --- updateState ----------------------------------------------------------

  it('updateState pushes Active=ACTIVE and CurrentHeaterCoolerState=COOLING when power=on', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'on' }],
      temperature: [{ current: '24.5', desired: '22' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.Active, ActiveValue.ACTIVE);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.CurrentHeaterCoolerState,
      CurrentHCState.COOLING,
    );
  });

  it('updateState pushes Active=INACTIVE and CurrentHeaterCoolerState=INACTIVE when power=off', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'off' }],
      temperature: [{ current: '24.5', desired: '22' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.Active, ActiveValue.INACTIVE);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.CurrentHeaterCoolerState,
      CurrentHCState.INACTIVE,
    );
  });

  it('updateState pushes parsed temperature.current and temperature.desired', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'on' }],
      temperature: [{ current: '24.5', desired: '22' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.CurrentTemperature, 24.5);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.CoolingThresholdTemperature, 22);
  });

  it('updateState always pushes TargetHeaterCoolerState=COOL', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'on' }],
      temperature: [{ current: '24.5', desired: '22' }],
    });
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(
      CharId.TargetHeaterCoolerState,
      TargetHCState.COOL,
    );
  });

  it('updateState marks Active/CurrentHeaterCoolerState Not Responding when power missing', () => {
    const { handler, svc, log } = setup();
    handler.updateState({ temperature: [{ current: '24.5', desired: '22' }] });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toEqual(
      expect.arrayContaining([CharId.Active, CharId.CurrentHeaterCoolerState]),
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('updateState marks CurrentTemperature Not Responding when temperature missing', () => {
    const { handler, svc } = setup();
    handler.updateState({ operation: [{ power: 'on' }] });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toContain(CharId.CurrentTemperature);
  });

  it('updateState marks CurrentTemperature Not Responding when current is not numeric', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'on' }],
      temperature: [{ current: 'NaN-like' }],
    });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toContain(CharId.CurrentTemperature);
  });

  it('updateState marks CoolingThresholdTemperature Not Responding when desired missing', () => {
    const { handler, svc } = setup();
    handler.updateState({
      operation: [{ power: 'on' }],
      temperature: [{ current: '24.5' }],
    });
    const errCalls = svc.updateCharacteristic.mock.calls.filter(
      ([, v]) => v instanceof FakeHapStatusError,
    );
    expect(errCalls.map(([c]) => c)).toContain(CharId.CoolingThresholdTemperature);
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

  // --- TargetHeaterCoolerState ---------------------------------------------

  it('TargetHeaterCoolerState onSet(COOL) is a no-op (no batch call)', async () => {
    const { targetState, client } = setup();
    await targetState.setHandler!(TargetHCState.COOL);
    expect(client.exeDeviceBatch).not.toHaveBeenCalled();
  });

  // --- CoolingThresholdTemperature -----------------------------------------

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
