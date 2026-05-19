import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { LightbulbAccessory } from './accessories/lightbulb.js';
import { HiotClient, type HiotClientLogger } from './api/client.js';
import type { Device } from './api/types.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TokenStore } from './storage/tokenStore.js';

const DEFAULT_BASE_URL = 'https://home.hiot.autoever.com:8443';

export interface HiotAccessoryContext {
  devicecd: string;
  devicetypecd: string;
  devicenm: string;
  spacenm?: string;
}

export class HiotPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly accessoriesByUUID = new Map<string, PlatformAccessory>();
  private readonly lightHandlersByUUID = new Map<string, LightbulbAccessory>();

  private readonly tokenStore: TokenStore;
  private readonly userid: string | undefined;
  private readonly password: string | undefined;
  private readonly baseUrl: string;
  private readonly pushRegistrationToken: string | undefined;
  private readonly clientLogger: HiotClientLogger;
  private client?: HiotClient;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug(`Initializing platform ${PLATFORM_NAME} (${PLUGIN_NAME})`);

    this.userid = typeof config.userid === 'string' && config.userid.length > 0 ? config.userid : undefined;
    this.password = typeof config.password === 'string' && config.password.length > 0 ? config.password : undefined;
    this.baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0 ? config.baseUrl : DEFAULT_BASE_URL;
    this.pushRegistrationToken =
      typeof config.pushRegistrationToken === 'string' && config.pushRegistrationToken.length > 0
        ? config.pushRegistrationToken
        : undefined;

    this.tokenStore = new TokenStore(this.api.user.storagePath());
    this.clientLogger = {
      debug: (m) => this.log.debug(m),
      warn: (m) => this.log.warn(m),
      error: (m) => this.log.error(m),
    };

    this.api.on('didFinishLaunching', () => {
      void this.handleDidFinishLaunching();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
    this.accessoriesByUUID.set(accessory.UUID, accessory);
  }

  async handleDidFinishLaunching(): Promise<void> {
    if (!this.userid || !this.password) {
      this.log.warn(
        'Hi-oT plugin not configured: userid/password missing in config. Skipping bootstrap.',
      );
      return;
    }

    const initialUserKeyValu = await this.tokenStore.load();

    this.client = new HiotClient({
      baseUrl: this.baseUrl,
      userid: this.userid,
      password: this.password,
      initialUserKeyValu,
      pushRegistrationToken: this.pushRegistrationToken,
      logger: this.clientLogger,
      onTokenUpdate: (token) => {
        void this.tokenStore.save(token).catch((err) => {
          this.log.warn(`failed to persist token: ${(err as Error).message}`);
        });
      },
    });

    try {
      await this.client.login();
      const devices = await this.client.getDeviceList();
      this.syncAccessories(devices.device ?? []);
    } catch (err) {
      this.log.error(`Hi-oT bootstrap failed: ${(err as Error).message}`);
    }
  }

  private syncAccessories(devices: Device[]): void {
    const seenUUIDs = new Set<string>();
    let added = 0;
    let restored = 0;

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.devicecd);
      seenUUIDs.add(uuid);

      const context: HiotAccessoryContext = {
        devicecd: device.devicecd,
        devicetypecd: device.devicetypecd,
        devicenm: device.devicenm,
        spacenm: device.spacenm,
      };

      const cached = this.accessoriesByUUID.get(uuid);
      if (cached) {
        cached.context = { ...context };
        this.attachHandler(cached);
        restored += 1;
        this.log.debug(
          `restored accessory devicecd=${device.devicecd} devicetypecd=${device.devicetypecd} spacenm=${device.spacenm ?? ''}`,
        );
        continue;
      }

      const accessory = new this.api.platformAccessory(device.devicenm, uuid);
      accessory.context = { ...context };
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      this.accessoriesByUUID.set(uuid, accessory);
      this.attachHandler(accessory);
      added += 1;
      this.log.debug(
        `registered accessory devicecd=${device.devicecd} devicetypecd=${device.devicetypecd} spacenm=${device.spacenm ?? ''}`,
      );
    }

    const stale: PlatformAccessory[] = [];
    for (const [uuid, cached] of this.accessoriesByUUID) {
      if (!seenUUIDs.has(uuid)) {
        stale.push(cached);
      }
    }
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const cached of stale) {
        this.accessoriesByUUID.delete(cached.UUID);
        this.lightHandlersByUUID.delete(cached.UUID);
        const idx = this.accessories.indexOf(cached);
        if (idx >= 0) {
          this.accessories.splice(idx, 1);
        }
        this.log.debug(`removed accessory uuid=${cached.UUID}`);
      }
    }

    this.log.info(
      `Hi-oT discovered ${devices.length} device(s) (${added} new, ${stale.length} removed, ${restored} restored).`,
    );
    this.log.info(`Hi-oT LGT handler attached: ${this.lightHandlersByUUID.size} device(s)`);
  }

  private attachHandler(accessory: PlatformAccessory): void {
    if (!this.client) {
      return;
    }
    const ctx = accessory.context as HiotAccessoryContext;
    if (ctx.devicetypecd !== 'LGT') {
      return;
    }
    if (this.lightHandlersByUUID.has(accessory.UUID)) {
      return;
    }
    const handler = new LightbulbAccessory(this.api, this.log, accessory, this.client);
    this.lightHandlersByUUID.set(accessory.UUID, handler);
  }
}
