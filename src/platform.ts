import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class HiotPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug(`Initializing platform ${PLATFORM_NAME} (${PLUGIN_NAME})`);

    // TODO: discover devices via Hi-oT API after didFinishLaunching
    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching');
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    // TODO: restore accessory state on Homebridge restart
    this.accessories.push(accessory);
  }
}
