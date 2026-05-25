import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElevatorAccessory } from '../../src/accessories/elevator.js';

// --- Minimal HomeKit mocks --------------------------------------------------

const ServiceId = {
  Switch: { UUID: 'Service.Switch' },
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
    displayName: '엘리베이터 호출',
    UUID: 'UUID:ELV',
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
  callElevator: ReturnType<typeof vi.fn>;
}

function makeClient(): ClientStub {
  return {
    callElevator: vi.fn().mockResolvedValue(undefined),
  };
}

function setup() {
  const api = makeApi();
  const log = makeLog();
  const accessory = makeAccessory({ kind: 'elevator' });
  const client = makeClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = new ElevatorAccessory(api as any, log as any, accessory as any, client as any);
  const svc = accessory.services.get(ServiceId.Switch)!;
  const on = svc.chars.get(CharId.On)!;
  return { api, log, accessory, client, handler, svc, on };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ElevatorAccessory', () => {
  it('adds a Switch service and registers only onSet for On (no onGet, no polling)', () => {
    const { svc, on } = setup();
    expect(svc).toBeDefined();
    expect(on.onGet).not.toHaveBeenCalled();
    expect(on.onSet).toHaveBeenCalledTimes(1);
  });

  it('sets AccessoryInformation Manufacturer / Model=ELV / SerialNumber', () => {
    const { accessory } = setup();
    const info = accessory.services.get(ServiceId.AccessoryInformation)!;
    expect(info).toBeDefined();
    const calls = info.setCharacteristic.mock.calls;
    expect(calls).toContainEqual([CharId.Manufacturer, 'Hi-oT (Hyundai Autoever)']);
    expect(calls).toContainEqual([CharId.Model, 'ELV']);
    expect(calls).toContainEqual([CharId.SerialNumber, 'ELV']);
  });

  it('reuses an existing Switch service if already attached', () => {
    const api = makeApi();
    const log = makeLog();
    const accessory = makeAccessory({ kind: 'elevator' });
    const preexisting = makeService();
    accessory.services.set(ServiceId.Switch, preexisting);

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ElevatorAccessory(api as any, log as any, accessory as any, client as any);

    expect(accessory.addService).not.toHaveBeenCalledWith(ServiceId.Switch);
    expect(preexisting.getCharacteristic).toHaveBeenCalledWith(CharId.On);
  });

  it('onSet(true) calls client.callElevator()', async () => {
    const { on, client } = setup();
    await on.setHandler!(true);
    expect(client.callElevator).toHaveBeenCalledTimes(1);
  });

  it('auto-resets On to false after 60 seconds', async () => {
    vi.useFakeTimers();
    const { on, svc, client } = setup();

    await on.setHandler!(true);
    expect(client.callElevator).toHaveBeenCalledTimes(1);
    expect(svc.updateCharacteristic).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(svc.updateCharacteristic).toHaveBeenCalledWith(CharId.On, false);
  });

  it('does not auto-reset before 60 seconds elapse', async () => {
    vi.useFakeTimers();
    const { on, svc } = setup();

    await on.setHandler!(true);
    vi.advanceTimersByTime(59_000);
    expect(svc.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('ignores a repeat onSet(true) while a call is already in progress and warns', async () => {
    vi.useFakeTimers();
    const { on, client, log } = setup();

    await on.setHandler!(true);
    await on.setHandler!(true);

    expect(client.callElevator).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();

    // after the window elapses, a new call is accepted again
    vi.advanceTimersByTime(60_000);
    await on.setHandler!(true);
    expect(client.callElevator).toHaveBeenCalledTimes(2);
  });

  it('onSet(false) cancels the pending auto-off timer and does not call the backend', async () => {
    vi.useFakeTimers();
    const { on, svc, client } = setup();

    await on.setHandler!(true);
    expect(client.callElevator).toHaveBeenCalledTimes(1);

    await on.setHandler!(false);
    // callElevator is only triggered by the ON edge
    expect(client.callElevator).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    // timer was cancelled, so no auto-off update is pushed
    expect(svc.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('throws SERVICE_COMMUNICATION_FAILURE and does not start the timer when the call fails', async () => {
    vi.useFakeTimers();
    const { on, svc, client, log } = setup();
    client.callElevator.mockRejectedValue(new Error('network'));

    await expect(on.setHandler!(true)).rejects.toBeInstanceOf(FakeHapStatusError);
    await expect(on.setHandler!(true)).rejects.toMatchObject({
      hapStatus: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(svc.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('dispose() clears a pending auto-off timer', async () => {
    vi.useFakeTimers();
    const { on, svc, handler } = setup();

    await on.setHandler!(true);
    handler.dispose();

    vi.advanceTimersByTime(60_000);
    expect(svc.updateCharacteristic).not.toHaveBeenCalled();
  });
});
