import { describe, expect, it } from 'vitest';

import { LightbulbAccessory } from '../../src/accessories/lightbulb.js';
import { LockAccessory } from '../../src/accessories/lock.js';
import { HANDLER_REGISTRY } from '../../src/accessories/registry.js';

describe('HANDLER_REGISTRY', () => {
  it('maps LGT to LightbulbAccessory ctor', () => {
    expect(HANDLER_REGISTRY.LGT).toBe(LightbulbAccessory);
  });

  it('maps GDK to LockAccessory ctor', () => {
    expect(HANDLER_REGISTRY.GDK).toBe(LockAccessory);
  });

  it('returns undefined for unknown devicetypecd', () => {
    expect(HANDLER_REGISTRY['UNKNOWN_TYPE']).toBeUndefined();
  });
});
