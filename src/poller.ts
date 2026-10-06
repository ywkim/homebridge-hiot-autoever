import type { HiotClient } from './api/client.js';
import type { Device, DeviceResponse } from './api/types.js';

export interface HiotPollerLogger {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Object that the poller refreshes on each tick. Implemented by accessory
 * handlers. The poller fetches `client.getDevice(devicecd)` and hands the
 * response to `updateState`, which is expected to push values into HomeKit
 * via `Service#updateCharacteristic`.
 */
/**
 * Types whose whole state is the list's on/off `attributevalu`. HTR/ACB/VNT
 * also carry temperature or airvolume that only `getDevice` returns, so they
 * keep per-device calls.
 */
const LIST_STATE_TYPES = new Set(['LGT', 'WSK', 'SWT', 'GDK']);

function stateFromListEntry(devicetypecd: string, entry: Device): DeviceResponse | undefined {
  const value = entry.attributevalu;
  if (value === undefined) {
    return undefined;
  }
  return devicetypecd === 'GDK' ? { valve: [{ lock: value }] } : { operation: [{ power: value }] };
}

export interface PollableHandler {
  readonly devicecd: string;
  readonly devicetypecd: string;
  updateState(res: DeviceResponse): void;
}

/**
 * Background-polling driver. Recommended Homebridge wiring per the
 * "Background polling" pattern: characteristics have no onGet handler;
 * the platform owns a periodic refresh loop and pushes values into the
 * HomeKit cache via updateCharacteristic. HomeKit reads from cache, so
 * onGet "slow" warnings and duplicate per-characteristic API hits go away.
 */
export class HiotPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly handlers = new Map<string, PollableHandler>();
  private tickInFlight = false;

  constructor(
    private readonly client: Pick<HiotClient, 'getDevice' | 'getDeviceList'>,
    private readonly log: HiotPollerLogger,
    private readonly intervalMs: number,
  ) {}

  register(uuid: string, handler: PollableHandler): void {
    this.handlers.set(uuid, handler);
  }

  unregister(uuid: string): void {
    this.handlers.delete(uuid);
  }

  size(): number {
    return this.handlers.size;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    // A long-running tick (e.g. backend stall) must not stack ticks behind it.
    if (this.tickInFlight) {
      this.log.debug('poll tick still in-flight; skipping overlapping tick');
      return;
    }
    this.tickInFlight = true;
    try {
      const handlers = [...this.handlers.values()];
      const listHandlers = handlers.filter((h) => LIST_STATE_TYPES.has(h.devicetypecd));
      const detailHandlers = handlers.filter((h) => !LIST_STATE_TYPES.has(h.devicetypecd));
      await Promise.all([
        this.refreshFromList(listHandlers),
        ...detailHandlers.map((handler) => this.refreshFromDetail(handler)),
      ]);
    } finally {
      this.tickInFlight = false;
    }
  }

  // One getDeviceList call replaces a getDevice call per on/off device. On
  // failure the last cached values stay in place; a missing entry is skipped.
  private async refreshFromList(handlers: PollableHandler[]): Promise<void> {
    if (handlers.length === 0) {
      return;
    }
    let list: Device[];
    try {
      list = (await this.client.getDeviceList()).device ?? [];
    } catch (err) {
      this.log.warn(`poll failed for getDeviceList: ${(err as Error).message}`);
      return;
    }
    const byCode = new Map(list.map((d) => [d.devicecd, d]));
    for (const handler of handlers) {
      const entry = byCode.get(handler.devicecd);
      const res = entry ? stateFromListEntry(handler.devicetypecd, entry) : undefined;
      if (!res) {
        this.log.debug(
          `poll list entry unusable devicecd=${handler.devicecd} devicetypecd=${handler.devicetypecd}`,
        );
        continue;
      }
      try {
        handler.updateState(res);
      } catch (err) {
        this.log.warn(`poll failed for devicetypecd=${handler.devicetypecd}: ${(err as Error).message}`);
      }
    }
  }

  private async refreshFromDetail(handler: PollableHandler): Promise<void> {
    try {
      const res = await this.client.getDevice(handler.devicecd);
      handler.updateState(res);
    } catch (err) {
      const msg = (err as Error).message;
      const cause = (err as Error).cause;
      let causeText = '';
      if (cause instanceof Error) {
        causeText = `: ${cause.message}`;
      } else if (typeof cause === 'string') {
        causeText = `: ${cause}`;
      }
      // Privacy: warn carries only devicetypecd (low apartment/user
      // identifiability) so diagnostics can separate per-type policy
      // quirks from transient backend flakiness. The full devicecd and
      // response body are emitted at debug level only, behind the
      // user's `homebridge -D`.
      this.log.warn(`poll failed for devicetypecd=${handler.devicetypecd}: ${msg}`);
      this.log.debug(
        `poll failed devicecd=${handler.devicecd} devicetypecd=${handler.devicetypecd}: ${msg}${causeText}`,
      );
    }
  }
}
