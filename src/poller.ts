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

export interface HiotPollerOptions {
  /** Interval for the per-device `getDevice` reads (HTR/ACB/VNT). Defaults to the list interval. */
  detailIntervalMs?: number;
  /** Delay before reading back state after a write, so the gateway has settled. */
  settleMs?: number;
}

const DEFAULT_SETTLE_MS = 8_000;

/**
 * Background-polling driver. Recommended Homebridge wiring per the
 * "Background polling" pattern: characteristics have no onGet handler;
 * the platform owns a periodic refresh loop and pushes values into the
 * HomeKit cache via updateCharacteristic. HomeKit reads from cache, so
 * onGet "slow" warnings and duplicate per-characteristic API hits go away.
 *
 * Two cadences: one `getDeviceList` per list interval carries on/off for every
 * device; the per-device `getDevice` reads (temperature, airvolume) run on the
 * slower detail interval, once at start, and shortly after a write.
 */
export class HiotPoller {
  private listTimer: ReturnType<typeof setInterval> | undefined;
  private detailTimer: ReturnType<typeof setInterval> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly handlers = new Map<string, PollableHandler>();
  private readonly detailCache = new Map<string, DeviceResponse>();
  private readonly pendingSettle = new Set<string>();
  private listInFlight = false;
  private detailInFlight = false;
  private readonly detailIntervalMs: number;
  private readonly settleMs: number;

  constructor(
    private readonly client: Pick<HiotClient, 'getDevice' | 'getDeviceList'>,
    private readonly log: HiotPollerLogger,
    private readonly intervalMs: number,
    options: HiotPollerOptions = {},
  ) {
    this.detailIntervalMs = options.detailIntervalMs ?? intervalMs;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  }

  register(uuid: string, handler: PollableHandler): void {
    this.handlers.set(uuid, handler);
  }

  unregister(uuid: string): void {
    const handler = this.handlers.get(uuid);
    if (handler) {
      this.detailCache.delete(handler.devicecd);
    }
    this.handlers.delete(uuid);
  }

  size(): number {
    return this.handlers.size;
  }

  start(): void {
    if (this.listTimer) {
      return;
    }
    void this.tick();
    this.listTimer = setInterval(() => {
      void this.refreshList();
    }, this.intervalMs);
    this.detailTimer = setInterval(() => {
      void this.refreshDetails();
    }, this.detailIntervalMs);
  }

  stop(): void {
    if (this.listTimer) {
      clearInterval(this.listTimer);
      this.listTimer = undefined;
    }
    if (this.detailTimer) {
      clearInterval(this.detailTimer);
      this.detailTimer = undefined;
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    this.pendingSettle.clear();
  }

  async tick(): Promise<void> {
    await Promise.all([this.refreshList(), this.refreshDetails()]);
  }

  /** Read state back once after writes to the given devices, debounced across calls. */
  refreshSoon(devicecds: string[]): void {
    for (const devicecd of devicecds) {
      this.pendingSettle.add(devicecd);
    }
    if (this.settleTimer) {
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      const written = new Set(this.pendingSettle);
      this.pendingSettle.clear();
      void Promise.all([this.refreshList(), this.refreshDetails(written)]);
    }, this.settleMs);
  }

  // One getDeviceList call replaces a getDevice call per on/off device. For
  // HTR/ACB/VNT it only refreshes power, patched onto the last detail response
  // because their handlers also need temperature/airvolume. On failure the last
  // cached values stay in place; a missing entry is skipped.
  async refreshList(): Promise<void> {
    // A long-running refresh (e.g. backend stall) must not stack behind itself.
    if (this.listInFlight) {
      this.log.debug('poll tick still in-flight; skipping overlapping tick');
      return;
    }
    const all = [...this.handlers.values()];
    const targets = all.filter(
      (h) => LIST_STATE_TYPES.has(h.devicetypecd) || this.detailCache.has(h.devicecd),
    );
    if (targets.length === 0) {
      return;
    }
    this.listInFlight = true;
    try {
      let list: Device[];
      try {
        list = (await this.client.getDeviceList()).device ?? [];
      } catch (err) {
        this.log.warn(`poll failed for getDeviceList: ${(err as Error).message}`);
        return;
      }
      const byCode = new Map(list.map((d) => [d.devicecd, d]));
      for (const handler of targets) {
        const entry = byCode.get(handler.devicecd);
        const res = entry ? this.stateFromList(handler, entry) : undefined;
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
    } finally {
      this.listInFlight = false;
    }
  }

  async refreshDetails(only?: Set<string>): Promise<void> {
    if (this.detailInFlight) {
      this.log.debug('poll detail tick still in-flight; skipping overlapping tick');
      return;
    }
    const targets = [...this.handlers.values()].filter(
      (h) => !LIST_STATE_TYPES.has(h.devicetypecd) && (!only || only.has(h.devicecd)),
    );
    if (targets.length === 0) {
      return;
    }
    this.detailInFlight = true;
    try {
      await Promise.all(targets.map((handler) => this.refreshFromDetail(handler)));
    } finally {
      this.detailInFlight = false;
    }
  }

  private stateFromList(handler: PollableHandler, entry: Device): DeviceResponse | undefined {
    const fromList = stateFromListEntry(handler.devicetypecd, entry);
    if (!fromList || LIST_STATE_TYPES.has(handler.devicetypecd)) {
      return fromList;
    }
    const cached = this.detailCache.get(handler.devicecd);
    if (!cached) {
      return undefined;
    }
    return { ...cached, operation: [{ ...cached.operation?.[0], ...fromList.operation?.[0] }] };
  }

  private async refreshFromDetail(handler: PollableHandler): Promise<void> {
    try {
      const res = await this.client.getDevice(handler.devicecd);
      this.detailCache.set(handler.devicecd, res);
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
