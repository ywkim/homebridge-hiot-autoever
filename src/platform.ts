import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { HiotClient, type HiotClientLogger } from './api/client.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TokenStore } from './storage/tokenStore.js';

const DEFAULT_BASE_URL = 'https://home.hiot.autoever.com:8443';

export class HiotPlatform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];

  private readonly tokenStore: TokenStore;
  private readonly userid: string | undefined;
  private readonly password: string | undefined;
  private readonly baseUrl: string;
  private readonly pushRegistrationToken: string | undefined;
  private readonly clientLogger: HiotClientLogger;

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
    // TODO: restore accessory state on Homebridge restart (next worktree)
    this.accessories.push(accessory);
  }

  async handleDidFinishLaunching(): Promise<void> {
    if (!this.userid || !this.password) {
      this.log.warn(
        'Hi-oT plugin not configured: userid/password missing in config. Skipping bootstrap.',
      );
      return;
    }

    const initialUserKeyValu = await this.tokenStore.load();

    const client = new HiotClient({
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
      await client.login();
      const devices = await client.getDeviceList();
      const count = devices.device?.length ?? 0;
      this.log.info(`Hi-oT login successful; discovered ${count} device(s).`);
      // Device identifiers/names intentionally suppressed at info level;
      // dump full list only when debug logging is enabled.
      this.log.debug(`device list: ${JSON.stringify(devices.device ?? [])}`);
    } catch (err) {
      this.log.error(`Hi-oT bootstrap failed: ${(err as Error).message}`);
    }
  }
}
