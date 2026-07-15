import type { HiotClient } from './api/client.js';
import type { DeviceResponse } from './api/types.js';

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
    private readonly client: Pick<HiotClient, 'getDevice'>,
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
      // Parallel fan-out across handlers: live measurement on the Hi-oT
      // backend showed 27 concurrent getDevice calls complete in ~4.6s vs
      // ~14.7s sequentially with 0 failures, so the backend tolerates the
      // burst and parallel keeps tick duration well under the polling
      // interval. Each handler is isolated in its own try/catch so a single
      // device failure does not abort the tick.
      await Promise.all(
        [...this.handlers.values()].map(async (handler) => {
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
        }),
      );
    } finally {
      this.tickInFlight = false;
    }
  }
}
