import { describe, expect, it } from 'vitest';

import { LightbulbAccessory } from '../../src/accessories/lightbulb.js';
import { OutletAccessory } from '../../src/accessories/outlet.js';
import { HANDLER_REGISTRY } from '../../src/accessories/registry.js';
import { SwitchAccessory } from '../../src/accessories/switch.js';

describe('HANDLER_REGISTRY', () => {
  it('maps LGT to LightbulbAccessory ctor', () => {
    expect(HANDLER_REGISTRY.LGT).toBe(LightbulbAccessory);
  });

  it('maps WSK to OutletAccessory ctor', () => {
    expect(HANDLER_REGISTRY.WSK).toBe(OutletAccessory);
  });

  it('maps SWT to SwitchAccessory ctor', () => {
    expect(HANDLER_REGISTRY.SWT).toBe(SwitchAccessory);
  });

  it('returns undefined for unknown devicetypecd', () => {
    expect(HANDLER_REGISTRY['UNKNOWN_TYPE']).toBeUndefined();
  });
});
