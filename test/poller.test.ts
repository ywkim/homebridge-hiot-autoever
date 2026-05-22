import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HiotPoller, type PollableHandler } from '../src/poller.js';
import type { DeviceResponse } from '../src/api/types.js';

interface ClientStub {
  getDevice: ReturnType<typeof vi.fn>;
}

interface LoggerStub {
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeClient(): ClientStub {
  return { getDevice: vi.fn() };
}

function makeLog(): LoggerStub {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface HandlerStub extends PollableHandler {
  updateState: ReturnType<typeof vi.fn>;
}

function makeHandler(devicecd: string): HandlerStub {
  return {
    devicecd,
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
});
