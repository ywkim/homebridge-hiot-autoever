import { describe, expect, it, vi } from 'vitest';

import { HiotPlatform } from '../src/platform.js';
import { PLATFORM_NAME } from '../src/settings.js';

function makeFakes() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  };
  const api = {
    on: vi.fn(),
    hap: {},
    platformAccessory: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  };
  const config = { platform: PLATFORM_NAME, userid: 'u', password: 'p' };
  return { log, api, config };
}

describe('HiotPlatform', () => {
  it('constructs without throwing', () => {
    const { log, api, config } = makeFakes();
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => new HiotPlatform(log as any, config as any, api as any),
    ).not.toThrow();
  });

  it('registers didFinishLaunching handler on the API', () => {
    const { log, api, config } = makeFakes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new HiotPlatform(log as any, config as any, api as any);
    expect(api.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
  });

  it('configureAccessory stores the accessory without throwing', () => {
    const { log, api, config } = makeFakes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const platform = new HiotPlatform(log as any, config as any, api as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessory = { displayName: 'x', UUID: 'uuid', context: {} } as any;
    expect(() => platform.configureAccessory(accessory)).not.toThrow();
    expect(platform.accessories).toContain(accessory);
  });
});
