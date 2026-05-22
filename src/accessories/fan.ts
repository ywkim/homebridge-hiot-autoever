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
 * Maps a Hi-oT VNT (ventilation) device to a HomeKit Fan v2 service.
 *
 * Reads happen through the platform's background poller, which calls
 * {@link FanAccessory.updateState} on each tick. Writes hit the backend
 * immediately via `client.exeDeviceBatch`.
 *
 * Only on/off is wired here; fan speed (RotationSpeed) is intentionally
 * deferred to a follow-up PR.
 */
export class FanAccessory implements PollableHandler {
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
      this.accessory.getService(HapService.Fanv2) ??
      this.accessory.addService(HapService.Fanv2);

    this.service.getCharacteristic(Characteristic.Active).onSet(this.handleActiveSet.bind(this));
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
    const power = res.operation?.[0]?.power;
    if (power === undefined) {
      this.log.warn(`VNT poll: power field missing for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.Active, this.notResponding());
      return;
    }
    this.service.updateCharacteristic(
      Characteristic.Active,
      power === 'on' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
    );
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    const power = value === Characteristic.Active.ACTIVE ? 'on' : 'off';

    let result;
    try {
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'operation', attribute: 'power', value: power },
      ]);
    } catch (err) {
      this.log.warn(`VNT onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`VNT onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }
}
