import type {
  API,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { HiotClient } from '../api/client.js';
import type { HiotAccessoryContext } from '../platform.js';

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';

/**
 * Maps a Hi-oT GDK (gas valve) device to a HomeKit LockMechanism service.
 *
 * Reads `valve[0].lock` from `client.getDevice` and writes back via
 * `client.exeDeviceBatch`. Per the project's mirroring principle, the
 * unlock direction is exposed without a safety guard — the Hi-oT app
 * itself exposes lock/unlock symmetrically.
 *
 * The exeDeviceBatch write shape (`resource: 'valve', attribute: 'lock'`)
 * is inferred from the getdevice response and has not yet been confirmed
 * against a wallpad capture. Confirm against a live set before relying
 * on it in mission-critical scenarios.
 */
export class LockAccessory {
  private readonly service: Service;

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly accessory: PlatformAccessory,
    private readonly client: HiotClient,
  ) {
    const { Service: HapService, Characteristic } = this.api.hap;
    const ctx = this.context();

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
      .getCharacteristic(Characteristic.LockCurrentState)
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(Characteristic.LockTargetState)
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async readLock(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    let lock: string | undefined;
    try {
      const res = await this.client.getDevice(ctx.devicecd);
      lock = res.valve?.[0]?.lock;
    } catch (err) {
      this.log.warn(`GDK onGet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
    if (lock === 'on') {
      return Characteristic.LockCurrentState.SECURED;
    }
    if (lock === 'off') {
      return Characteristic.LockCurrentState.UNSECURED;
    }
    this.log.warn(
      `GDK onGet: unexpected valve lock value ${JSON.stringify(lock)} for devicetypecd=${ctx.devicetypecd}`,
    );
    throw this.notResponding();
  }

  private handleCurrentStateGet(): Promise<CharacteristicValue> {
    return this.readLock();
  }

  private handleTargetStateGet(): Promise<CharacteristicValue> {
    return this.readLock();
  }

  private async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    const lock = Number(value) === Characteristic.LockTargetState.SECURED ? 'on' : 'off';

    let result;
    try {
      // TODO: `resource: 'valve', attribute: 'lock'` is inferred from the
      // getdevice response shape — confirm against a Hi-oT capture of the
      // wallpad setting the gas valve.
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'valve', attribute: 'lock', value: lock },
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
