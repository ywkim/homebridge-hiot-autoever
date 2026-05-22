import type { API, Logger, PlatformAccessory } from 'homebridge';

import type { HiotClient } from '../api/client.js';
import { LightbulbAccessory } from './lightbulb.js';
import { OutletAccessory } from './outlet.js';
import { SwitchAccessory } from './switch.js';

export type AccessoryHandlerCtor = new (
  api: API,
  log: Logger,
  accessory: PlatformAccessory,
  client: HiotClient,
) => unknown;

export const HANDLER_REGISTRY: Record<string, AccessoryHandlerCtor> = {
  LGT: LightbulbAccessory,
  WSK: OutletAccessory,
  SWT: SwitchAccessory,
};
