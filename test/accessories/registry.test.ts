import { describe, expect, it } from 'vitest';

import { FanAccessory } from '../../src/accessories/fan.js';
import { HeaterCoolerAccessory } from '../../src/accessories/heaterCooler.js';
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

  it('maps ACB to HeaterCoolerAccessory ctor', () => {
    expect(HANDLER_REGISTRY.ACB).toBe(HeaterCoolerAccessory);
  });

  it('maps VNT to FanAccessory ctor', () => {
    expect(HANDLER_REGISTRY.VNT).toBe(FanAccessory);
  });

  it('returns undefined for unknown devicetypecd', () => {
    expect(HANDLER_REGISTRY['UNKNOWN_TYPE']).toBeUndefined();
  });
});
