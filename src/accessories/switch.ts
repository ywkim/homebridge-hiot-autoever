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
 * Maps a Hi-oT SWT (all-off / scene switch) device to a HomeKit Switch service.
 *
 * Wires the `On` characteristic to:
 *   - `client.getDevice(devicecd)` for reads
 *   - `client.exeDeviceBatch([...])` for writes
 *
 * Failures surface as `HapStatusError(SERVICE_COMMUNICATION_FAILURE)`
 * so HomeKit shows the accessory as "Not Responding" rather than
 * caching a stale state.
 */
export class SwitchAccessory {
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
      this.accessory.getService(HapService.Switch) ??
      this.accessory.addService(HapService.Switch);

    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async handleOnGet(): Promise<CharacteristicValue> {
    const ctx = this.context();
    let power: string | undefined;
    try {
      const res = await this.client.getDevice(ctx.devicecd);
      power = res.operation?.[0]?.power;
    } catch (err) {
      this.log.warn(`SWT onGet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
    if (power === undefined) {
      this.log.warn(`SWT onGet: power field missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return power === 'on';
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
      this.log.warn(`SWT onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`SWT onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }
}
