import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { ElevatorAccessory } from './accessories/elevator.js';
import { HANDLER_REGISTRY } from './accessories/registry.js';
import { HiotClient, type HiotClientLogger } from './api/client.js';
import type { Device } from './api/types.js';
import { HiotPoller, type PollableHandler } from './poller.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TokenStore } from './storage/tokenStore.js';

const DEFAULT_BASE_URL = 'https://home.hiot.autoever.com:8443';
const DEFAULT_POLLING_INTERVAL_MS = 30_000;
const MIN_POLLING_INTERVAL_MS = 5_000;

/** Stable seed for the elevator (ELV) accessory UUID. ELV is a service, not a
 * device, so it never appears in `getdevicelist` and has no devicecd. */
const ELEVATOR_UUID_SEED = 'ELV';
const ELEVATOR_DISPLAY_NAME = '엘리베이터 호출';

export interface HiotAccessoryContext {
  devicecd: string;
  devicetypecd: string;
  devicenm: string;
  spacenm?: string;
}

export class HiotPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  private readonly accessoriesByUUID = new Map<string, PlatformAccessory>();
  private readonly handlersByUUID = new Map<string, PollableHandler>();

  private readonly tokenStore: TokenStore;
  private readonly userid: string | undefined;
  private readonly password: string | undefined;
  private readonly baseUrl: string;
  private readonly pushRegistrationToken: string | undefined;
  private readonly pollingIntervalMs: number;
  private readonly elevatorEnabled: boolean;
  private readonly clientLogger: HiotClientLogger;
  private client?: HiotClient;
  private poller?: HiotPoller;
  private elevatorHandler?: ElevatorAccessory;

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
    this.pollingIntervalMs = this.resolvePollingIntervalMs(config.pollingIntervalMs);
    this.elevatorEnabled = config.elevator === true;

    this.tokenStore = new TokenStore(this.api.user.storagePath());
    this.clientLogger = {
      debug: (m) => this.log.debug(m),
      warn: (m) => this.log.warn(m),
      error: (m) => this.log.error(m),
    };

    this.api.on('didFinishLaunching', () => {
      void this.handleDidFinishLaunching();
    });
    this.api.on('shutdown', () => {
      this.elevatorHandler?.dispose();
    });
  }

  private resolvePollingIntervalMs(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return DEFAULT_POLLING_INTERVAL_MS;
    }
    if (raw < MIN_POLLING_INTERVAL_MS) {
      this.log.warn(
        `pollingIntervalMs=${raw} below minimum ${MIN_POLLING_INTERVAL_MS}; clamping to minimum`,
      );
      return MIN_POLLING_INTERVAL_MS;
    }
    return raw;
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

    this.poller = new HiotPoller(this.client, this.clientLogger, this.pollingIntervalMs);

    try {
      await this.client.login();
      const devices = await this.client.getDeviceList();
      this.syncAccessories(devices.device ?? []);
      this.syncElevator();
      this.poller.start();
    } catch (err) {
      const msg = (err as Error).message;
      const cause = (err as Error).cause;
      let causeText = '';
      if (cause instanceof Error) {
        causeText = `: ${cause.message}`;
      } else if (typeof cause === 'string') {
        causeText = `: ${cause}`;
      }
      this.log.error(`Hi-oT bootstrap failed: ${msg}`);
      this.log.debug(`Hi-oT bootstrap failed: ${msg}${causeText}`);
    }
  }

  private syncAccessories(devices: Device[]): void {
    const seenUUIDs = new Set<string>();
    // The elevator (ELV) accessory has its own lifecycle in syncElevator and
    // is not part of the device list; mark it seen so it is never treated as
    // stale and unregistered by the device-sync sweep below.
    seenUUIDs.add(this.elevatorUUID());
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
        this.handlersByUUID.delete(cached.UUID);
        this.poller?.unregister(cached.UUID);
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
    const byType: Record<string, number> = {};
    for (const uuid of this.handlersByUUID.keys()) {
      const cached = this.accessoriesByUUID.get(uuid);
      const ctx = cached?.context as HiotAccessoryContext | undefined;
      if (!ctx) {
        continue;
      }
      byType[ctx.devicetypecd] = (byType[ctx.devicetypecd] ?? 0) + 1;
    }
    const summary =
      Object.entries(byType)
        .map(([t, c]) => `${t}=${c}`)
        .join(', ') || 'none';
    this.log.info(`Hi-oT handlers attached: ${summary}`);
  }

  private elevatorUUID(): string {
    return this.api.hap.uuid.generate(ELEVATOR_UUID_SEED);
  }

  /**
   * Manage the opt-in elevator (ELV) accessory outside the device loop. ELV is
   * a Hi-oT service, not a device, so it never appears in `getdevicelist`.
   */
  private syncElevator(): void {
    if (!this.client) {
      return;
    }
    const uuid = this.elevatorUUID();
    const cached = this.accessoriesByUUID.get(uuid);

    if (!this.elevatorEnabled) {
      if (cached) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
        this.accessoriesByUUID.delete(uuid);
        const idx = this.accessories.indexOf(cached);
        if (idx >= 0) {
          this.accessories.splice(idx, 1);
        }
        this.elevatorHandler?.dispose();
        this.elevatorHandler = undefined;
        this.log.debug('removed elevator accessory (config.elevator disabled)');
      }
      return;
    }

    let accessory = cached;
    if (!accessory) {
      accessory = new this.api.platformAccessory(ELEVATOR_DISPLAY_NAME, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      this.accessoriesByUUID.set(uuid, accessory);
      this.log.debug('registered elevator accessory');
    } else {
      this.log.debug('restored elevator accessory');
    }
    accessory.context = { kind: 'elevator' };
    // Dispose any prior handler before replacing it so a pending auto-off timer
    // from an earlier instance can't outlive it (keeps re-sync idempotent).
    this.elevatorHandler?.dispose();
    this.elevatorHandler = new ElevatorAccessory(this.api, this.log, accessory, this.client);
  }

  private attachHandler(accessory: PlatformAccessory): void {
    if (!this.client) {
      return;
    }
    const ctx = accessory.context as HiotAccessoryContext;
    const Ctor = HANDLER_REGISTRY[ctx.devicetypecd];
    if (!Ctor) {
      return;
    }
    if (this.handlersByUUID.has(accessory.UUID)) {
      return;
    }
    const handler = new Ctor(this.api, this.log, accessory, this.client);
    this.handlersByUUID.set(accessory.UUID, handler);
    this.poller?.register(accessory.UUID, handler);
  }
}
