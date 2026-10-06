import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HiotPoller, type PollableHandler } from '../src/poller.js';
import type { DeviceResponse } from '../src/api/types.js';

interface ClientStub {
  getDevice: ReturnType<typeof vi.fn>;
  getDeviceList: ReturnType<typeof vi.fn>;
}

interface LoggerStub {
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeClient(): ClientStub {
  return { getDevice: vi.fn(), getDeviceList: vi.fn() };
}

function makeLog(): LoggerStub {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface HandlerStub extends PollableHandler {
  updateState: ReturnType<typeof vi.fn>;
}

function makeHandler(devicecd: string, devicetypecd = 'HTR'): HandlerStub {
  return {
    devicecd,
    devicetypecd,
    updateState: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HiotPoller', () => {
  it('start schedules setInterval at intervalMs', () => {
    const client = makeClient();
    const log = makeLog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 5000);
    const spy = vi.spyOn(globalThis, 'setInterval');
    poller.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 5000);
    poller.stop();
  });

  it('start does nothing on second call when already running', () => {
    const client = makeClient();
    const log = makeLog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 5000);
    const spy = vi.spyOn(globalThis, 'setInterval');
    poller.start();
    poller.start();
    expect(spy).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('stop clears the interval', () => {
    const client = makeClient();
    const log = makeLog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 5000);
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    poller.start();
    poller.stop();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('stop is safe to call before start', () => {
    const client = makeClient();
    const log = makeLog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 5000);
    expect(() => poller.stop()).not.toThrow();
  });

  it('tick calls getDevice for each registered handler', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockImplementation(async (devicecd: string) => ({
      operation: [{ power: 'on' }],
      _devicecd: devicecd,
    } as unknown as DeviceResponse));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('LGT_A'));
    poller.register('uuid-b', makeHandler('WSK_B'));
    await poller.tick();

    expect(client.getDevice).toHaveBeenCalledTimes(2);
    expect(client.getDevice).toHaveBeenCalledWith('LGT_A');
    expect(client.getDevice).toHaveBeenCalledWith('WSK_B');
  });

  it('tick passes the per-device response to each handler.updateState', async () => {
    const client = makeClient();
    const log = makeLog();
    const aRes = { operation: [{ power: 'on' }] };
    const bRes = { operation: [{ power: 'off' }] };
    client.getDevice.mockImplementation(async (devicecd: string) =>
      devicecd === 'LGT_A' ? aRes : bRes,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const a = makeHandler('LGT_A');
    const b = makeHandler('LGT_B');
    poller.register('uuid-a', a);
    poller.register('uuid-b', b);
    await poller.tick();

    expect(a.updateState).toHaveBeenCalledTimes(1);
    expect(a.updateState).toHaveBeenCalledWith(aRes);
    expect(b.updateState).toHaveBeenCalledTimes(1);
    expect(b.updateState).toHaveBeenCalledWith(bRes);
  });

  it('tick continues to other handlers when one getDevice rejects', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockImplementation(async (devicecd: string) => {
      if (devicecd === 'BAD') {
        throw new Error('upstream 500');
      }
      return { operation: [{ power: 'on' }] };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const bad = makeHandler('BAD');
    const good = makeHandler('GOOD');
    poller.register('uuid-bad', bad);
    poller.register('uuid-good', good);
    await poller.tick();

    expect(bad.updateState).not.toHaveBeenCalled();
    expect(good.updateState).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('tick continues to other handlers when one updateState throws', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const boom = makeHandler('BOOM');
    boom.updateState.mockImplementation(() => {
      throw new Error('handler bug');
    });
    const ok = makeHandler('OK');
    poller.register('uuid-boom', boom);
    poller.register('uuid-ok', ok);
    await poller.tick();

    expect(ok.updateState).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('start triggers an immediate tick (does not wait one interval)', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const h = makeHandler('A');
    poller.register('uuid-a', h);
    poller.start();
    // Drain microtasks; do not advance fake timers.
    await vi.waitFor(() => {
      expect(client.getDevice).toHaveBeenCalledTimes(1);
    });
    poller.stop();
  });

  it('subsequent ticks fire after each intervalMs', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const h = makeHandler('A');
    poller.register('uuid-a', h);
    poller.start();
    await vi.waitFor(() => {
      expect(client.getDevice).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(30000);
    await vi.waitFor(() => {
      expect(client.getDevice).toHaveBeenCalledTimes(2);
    });

    await vi.advanceTimersByTimeAsync(30000);
    await vi.waitFor(() => {
      expect(client.getDevice).toHaveBeenCalledTimes(3);
    });

    poller.stop();
  });

  it('unregister removes the handler from subsequent ticks', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockResolvedValue({ operation: [{ power: 'on' }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    const a = makeHandler('A');
    const b = makeHandler('B');
    poller.register('uuid-a', a);
    poller.register('uuid-b', b);
    await poller.tick();
    expect(client.getDevice).toHaveBeenCalledTimes(2);

    poller.unregister('uuid-a');
    client.getDevice.mockClear();
    await poller.tick();
    expect(client.getDevice).toHaveBeenCalledTimes(1);
    expect(client.getDevice).toHaveBeenCalledWith('B');
  });

  it('skips overlapping tick when prior is still in-flight', async () => {
    const client = makeClient();
    const log = makeLog();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.getDevice.mockImplementation(async () => {
      await gate;
      return { operation: [{ power: 'on' }] };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('A'));

    const first = poller.tick();
    // Second tick begins before the first has finished.
    const second = poller.tick();
    release();
    await first;
    await second;

    expect(client.getDevice).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalled();
  });

  it('tick fans out in parallel (all getDevice in flight before any resolves)', async () => {
    const client = makeClient();
    const log = makeLog();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlight = 0;
    let peak = 0;
    client.getDevice.mockImplementation(async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await gate;
      inFlight--;
      return { operation: [{ power: 'on' }] };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('A'));
    poller.register('uuid-b', makeHandler('B'));
    poller.register('uuid-c', makeHandler('C'));
    const t = poller.tick();
    // Drain microtasks so every parallel client.getDevice() can start.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(3);
    release();
    await t;
  });

  it('does not log devicecd in warn payloads (privacy)', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockRejectedValue(new Error('upstream'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('SECRET_DEVICECD'));
    await poller.tick();

    const visible = log.warn.mock.calls.flat().map(String).join(' ');
    expect(visible).not.toContain('SECRET_DEVICECD');
  });

  it('warn log on poll failure includes devicetypecd but not devicecd', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockRejectedValue(new Error('upstream 500'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('HTR_TEST_001', 'HTR'));
    await poller.tick();

    const warned = log.warn.mock.calls.flat().map(String).join(' ');
    expect(warned).toContain('devicetypecd=HTR');
    // Privacy regression guard: the full devicecd must never reach warn.
    expect(warned).not.toContain('HTR_TEST_001');
    expect(warned).not.toContain('devicecd=');
  });

  it('debug log on poll failure includes the full devicecd', async () => {
    const client = makeClient();
    const log = makeLog();
    client.getDevice.mockRejectedValue(new Error('upstream 500'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poller = new HiotPoller(client as any, log, 30000);
    poller.register('uuid-a', makeHandler('HTR_TEST_001', 'HTR'));
    await poller.tick();

    const debugged = log.debug.mock.calls.flat().map(String).join(' ');
    expect(debugged).toContain('devicecd=HTR_TEST_001');
    expect(debugged).toContain('devicetypecd=HTR');
  });

  describe('list-based refresh', () => {
    it('refreshes LGT/WSK/SWT from one getDeviceList call without getDevice', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDeviceList.mockResolvedValue({
        device: [
          { devicecd: 'L1', attributevalu: 'on' },
          { devicecd: 'W1', attributevalu: 'off' },
          { devicecd: 'S1', attributevalu: 'on' },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      const l = makeHandler('L1', 'LGT');
      const w = makeHandler('W1', 'WSK');
      const s = makeHandler('S1', 'SWT');
      poller.register('u-l', l);
      poller.register('u-w', w);
      poller.register('u-s', s);
      await poller.tick();

      expect(client.getDeviceList).toHaveBeenCalledTimes(1);
      expect(client.getDevice).not.toHaveBeenCalled();
      expect(l.updateState).toHaveBeenCalledWith({ operation: [{ power: 'on' }] });
      expect(w.updateState).toHaveBeenCalledWith({ operation: [{ power: 'off' }] });
      expect(s.updateState).toHaveBeenCalledWith({ operation: [{ power: 'on' }] });
    });

    it('maps GDK attributevalu to valve.lock', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDeviceList.mockResolvedValue({ device: [{ devicecd: 'G1', attributevalu: 'off' }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      const g = makeHandler('G1', 'GDK');
      poller.register('u-g', g);
      await poller.tick();

      expect(g.updateState).toHaveBeenCalledWith({ valve: [{ lock: 'off' }] });
    });

    it('still calls getDevice for HTR/ACB/VNT and getDeviceList once for the rest', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDeviceList.mockResolvedValue({ device: [{ devicecd: 'L1', attributevalu: 'on' }] });
      client.getDevice.mockResolvedValue({ temperature: [{ current: '22' }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      poller.register('u-l', makeHandler('L1', 'LGT'));
      poller.register('u-h', makeHandler('H1', 'HTR'));
      poller.register('u-a', makeHandler('A1', 'ACB'));
      poller.register('u-v', makeHandler('V1', 'VNT'));
      await poller.tick();

      expect(client.getDeviceList).toHaveBeenCalledTimes(1);
      expect(client.getDevice).toHaveBeenCalledTimes(3);
      expect(client.getDevice).not.toHaveBeenCalledWith('L1');
    });

    it('skips getDeviceList when only detail-type handlers are registered', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDevice.mockResolvedValue({ temperature: [{ current: '22' }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      poller.register('u-h', makeHandler('H1', 'HTR'));
      await poller.tick();

      expect(client.getDeviceList).not.toHaveBeenCalled();
    });

    it('keeps last values and warns without devicecd when getDeviceList fails; detail handlers still update', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDeviceList.mockRejectedValue(new Error('upstream 500'));
      client.getDevice.mockResolvedValue({ temperature: [{ current: '22' }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      const l = makeHandler('SECRET_L1', 'LGT');
      const h = makeHandler('H1', 'HTR');
      poller.register('u-l', l);
      poller.register('u-h', h);
      await poller.tick();

      expect(l.updateState).not.toHaveBeenCalled();
      expect(h.updateState).toHaveBeenCalledTimes(1);
      const warned = log.warn.mock.calls.flat().map(String).join(' ');
      expect(warned).toContain('getDeviceList');
      expect(warned).not.toContain('SECRET_L1');
    });

    it('skips a handler missing from the list or lacking attributevalu, logging at debug only', async () => {
      const client = makeClient();
      const log = makeLog();
      client.getDeviceList.mockResolvedValue({
        device: [
          { devicecd: 'NOVAL' },
          { devicecd: 'OK1', attributevalu: 'on' },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poller = new HiotPoller(client as any, log, 30000);
      const gone = makeHandler('GONE', 'LGT');
      const noval = makeHandler('NOVAL', 'LGT');
      const ok = makeHandler('OK1', 'LGT');
      poller.register('u-g', gone);
      poller.register('u-n', noval);
      poller.register('u-o', ok);
      await poller.tick();

      expect(gone.updateState).not.toHaveBeenCalled();
      expect(noval.updateState).not.toHaveBeenCalled();
      expect(ok.updateState).toHaveBeenCalledTimes(1);
      const warned = log.warn.mock.calls.flat().map(String).join(' ');
      expect(warned).not.toContain('GONE');
      expect(warned).not.toContain('NOVAL');
    });
  });
});
