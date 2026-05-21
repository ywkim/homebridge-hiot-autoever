import { describe, expect, it } from 'vitest';

import { LightbulbAccessory } from '../../src/accessories/lightbulb.js';
import { HANDLER_REGISTRY } from '../../src/accessories/registry.js';

describe('HANDLER_REGISTRY', () => {
  it('maps LGT to LightbulbAccessory ctor', () => {
    expect(HANDLER_REGISTRY.LGT).toBe(LightbulbAccessory);
  });

  it('returns undefined for unknown devicetypecd', () => {
    expect(HANDLER_REGISTRY['UNKNOWN_TYPE']).toBeUndefined();
  });
});
