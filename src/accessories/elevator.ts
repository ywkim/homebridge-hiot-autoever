import type {
  API,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { HiotClient } from '../api/client.js';

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';
const MODEL = 'ELV';
const SERIAL_NUMBER = 'ELV';
const SERVICE_NAME = '엘리베이터 호출';

/**
 * Auto-off window. The Hi-oT app shows a 60s "calling" state (a client-side
 * timer) after an elevator call; we mirror that in HomeKit by flipping the
 * Switch back OFF after the same interval so the tile reflects the app.
 */
const AUTO_OFF_MS = 60_000;

/** Minimal client surface this accessory depends on. */
export type ElevatorClient = Pick<HiotClient, 'callElevator'>;

/**
 * Exposes the Hi-oT elevator call ("EV호출" / 엘리베이터 호출) as a HomeKit
 * Switch. HomeKit has no elevator service type, and the backend call is
 * fire-and-forget with no pollable state, so this is not a PollableHandler and
 * is never registered with the poller.
 *
 * Turning the Switch ON issues `client.callElevator()` and starts a 60s timer
 * that flips it back OFF, mirroring the app's "calling" indicator. While that
 * window is open, a repeat ON is ignored (mirrors the app's 1-call-per-minute
 * limit). The app's outing-guard and rate-limit warnings are client-side only
 * and are intentionally not enforced here per the plugin's 1:1 mirror policy.
 */
export class ElevatorAccessory {
  private readonly service: Service;
  private autoOffTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly client: ElevatorClient,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;

    const info =
      this.accessory.getService(HapService.AccessoryInformation) ??
      this.accessory.addService(HapService.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, MODEL)
      .setCharacteristic(Characteristic.SerialNumber, SERIAL_NUMBER);

    this.service =
      this.accessory.getService(HapService.Switch) ??
      this.accessory.addService(HapService.Switch);
    this.service.setCharacteristic(Characteristic.Name, SERVICE_NAME);

    this.service.getCharacteristic(Characteristic.On).onSet(this.handleOnSet.bind(this));
  }

  /** Clear any pending auto-off timer (called on platform shutdown). */
  dispose(): void {
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = undefined;
    }
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    if (!value) {
      // OFF edge: cancel the auto-off window. No backend call — the call is
      // only triggered by the ON edge.
      this.dispose();
      return;
    }

    if (this.autoOffTimer) {
      // A call is still within its 60s window. Mirror the Hi-oT app's
      // 1-call-per-minute limit by ignoring the repeat instead of re-calling.
      this.log.warn('elevator call already in progress; ignoring repeat (1-call-per-minute mirror)');
      return;
    }

    try {
      await this.client.callElevator();
    } catch (err) {
      this.log.warn(`elevator call failed: ${(err as Error).message}`);
      throw this.notResponding();
    }

    this.startAutoOff();
  }

  private startAutoOff(): void {
    const timer = setTimeout(() => {
      this.autoOffTimer = undefined;
      this.service.updateCharacteristic(this.api.hap.Characteristic.On, false);
    }, AUTO_OFF_MS);
    // Don't let the auto-off timer keep the Node process alive.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.autoOffTimer = timer;
  }
}
