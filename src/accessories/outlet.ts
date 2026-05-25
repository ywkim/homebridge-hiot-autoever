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
 * Maps a Hi-oT WSK (smart outlet) device to a HomeKit Outlet service.
 *
 * Reads happen through the platform's background poller, which calls
 * {@link OutletAccessory.updateState} on each tick. Writes hit the backend
 * immediately via `client.exeDeviceBatch`.
 */
export class OutletAccessory implements PollableHandler {
  public readonly devicecd: string;
  public readonly devicetypecd: string;
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
    this.devicetypecd = ctx.devicetypecd;

    const info =
      this.accessory.getService(HapService.AccessoryInformation) ??
      this.accessory.addService(HapService.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, ctx.devicetypecd)
      .setCharacteristic(Characteristic.SerialNumber, ctx.devicecd);

    this.service =
      this.accessory.getService(HapService.Outlet) ??
      this.accessory.addService(HapService.Outlet);

    this.service.getCharacteristic(Characteristic.On).onSet(this.handleOnSet.bind(this));
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
      this.log.warn(`WSK poll: power field missing for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.On, this.notResponding());
      return;
    }
    this.service.updateCharacteristic(Characteristic.On, power === 'on');
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const ctx = this.context();
    const power = value ? 'on' : 'off';

    let result;
    try {
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'operation', attribute: 'power', value: power },
      ]);
    } catch (err) {
      this.log.warn(`WSK onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`WSK onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }
}
