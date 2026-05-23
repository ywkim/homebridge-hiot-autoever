import type {
  API,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { HiotClient } from '../api/client.js';
import type { DeviceResponse } from '../api/types.js';
import type { HiotAccessoryContext } from '../platform.js';
import type { PollableHandler } from '../poller.js';

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';

/**
 * Maps a Hi-oT GDK (gas valve) device to a HomeKit LockMechanism service.
 *
 * Reads happen through the platform's background poller, which calls
 * {@link LockAccessory.updateState} on each tick. Writes hit the backend
 * immediately via `client.exeDeviceBatch`.
 *
 * Backend value semantics (verified live): `lock='off'` = closed/locked
 * = SECURED, `lock='on'` = open = UNSECURED.
 *
 * Mirrors the Hi-oT mobile app, which exposes the lock direction only
 * and blocks unlock from the app for safety. We mirror that constraint
 * in HomeKit via `LockTargetState.setProps({ validValues: [SECURED] })`,
 * disabling the unlock button. Opening the gas valve requires physical
 * means (kitchen wallpad, manual lever).
 */
export class LockAccessory implements PollableHandler {
  public readonly devicecd: string;
  private readonly service: Service;

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly client: HiotClient,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;
    const ctx = this.context();
    this.devicecd = ctx.devicecd;

    const info =
      this.accessory.getService(HapService.AccessoryInformation) ??
      this.accessory.addService(HapService.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, ctx.devicetypecd)
      .setCharacteristic(Characteristic.SerialNumber, ctx.devicecd);

    this.service =
      this.accessory.getService(HapService.LockMechanism) ??
      this.accessory.addService(HapService.LockMechanism);

    this.service
      .getCharacteristic(Characteristic.LockTargetState)
      .setProps({ validValues: [Characteristic.LockTargetState.SECURED] })
      .onSet(this.handleTargetStateSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  updateState(res: DeviceResponse): void {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    const lock = res.valve?.[0]?.lock;
    let current: CharacteristicValue;
    if (lock === 'off') {
      current = Characteristic.LockCurrentState.SECURED;
    } else if (lock === 'on') {
      current = Characteristic.LockCurrentState.UNSECURED;
    } else {
      this.log.warn(
        `GDK poll: unexpected valve lock value ${JSON.stringify(lock)} for devicetypecd=${ctx.devicetypecd}`,
      );
      const err = this.notResponding();
      this.service.updateCharacteristic(Characteristic.LockCurrentState, err);
      this.service.updateCharacteristic(Characteristic.LockTargetState, err);
      return;
    }
    this.service.updateCharacteristic(Characteristic.LockCurrentState, current);
    // LockTargetState is locked to SECURED by setProps; refresh the cached
    // value so HomeKit always observes the constrained intent even when the
    // physical valve is open.
    this.service.updateCharacteristic(
      Characteristic.LockTargetState,
      Characteristic.LockTargetState.SECURED,
    );
  }

  private async handleTargetStateSet(_value: CharacteristicValue): Promise<void> {
    const ctx = this.context();

    let result;
    try {
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'valve', attribute: 'lock', value: 'off' },
      ]);
    } catch (err) {
      this.log.warn(`GDK onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`GDK onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }
}
