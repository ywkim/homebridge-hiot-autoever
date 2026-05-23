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

const COOL_THRESHOLD_MIN = 18;
const COOL_THRESHOLD_MAX = 30;
const COOL_THRESHOLD_STEP = 1;

/**
 * Maps a Hi-oT ACB (air conditioner) device to a HomeKit HeaterCooler service.
 *
 * Reads happen through the platform's background poller, which calls
 * {@link HeaterCoolerAccessory.updateState} on each tick. Writes hit the
 * backend immediately via `client.exeDeviceBatch`.
 *
 * Scope (this PR): Active, CurrentTemperature, CurrentHeaterCoolerState,
 * TargetHeaterCoolerState (locked to COOL), CoolingThresholdTemperature.
 * Fan speed / swing / HEAT|AUTO modes / 0.5°C precision are deferred.
 *
 * The `temperature[0].desired` write attribute is empirically inferred from
 * Hi-oT app behavior and may need adjustment after capture validation.
 */
export class HeaterCoolerAccessory implements PollableHandler {
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
      this.accessory.getService(HapService.HeaterCooler) ??
      this.accessory.addService(HapService.HeaterCooler);

    this.service
      .getCharacteristic(Characteristic.Active)
      .onSet(this.handleActiveSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onSet(this.handleTargetStateSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: COOL_THRESHOLD_MIN,
        maxValue: COOL_THRESHOLD_MAX,
        minStep: COOL_THRESHOLD_STEP,
      })
      .onSet(this.handleCoolingThresholdSet.bind(this));
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
      this.log.warn(`ACB poll: operation[0].power missing for devicetypecd=${ctx.devicetypecd}`);
      const err = this.notResponding();
      this.service.updateCharacteristic(Characteristic.Active, err);
      this.service.updateCharacteristic(Characteristic.CurrentHeaterCoolerState, err);
    } else {
      this.service.updateCharacteristic(
        Characteristic.Active,
        power === 'on' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
      );
      this.service.updateCharacteristic(
        Characteristic.CurrentHeaterCoolerState,
        power === 'on'
          ? Characteristic.CurrentHeaterCoolerState.COOLING
          : Characteristic.CurrentHeaterCoolerState.INACTIVE,
      );
    }

    // TargetHeaterCoolerState is locked to COOL by setProps; refresh the
    // cached value so HomeKit always observes the constrained value.
    this.service.updateCharacteristic(
      Characteristic.TargetHeaterCoolerState,
      Characteristic.TargetHeaterCoolerState.COOL,
    );

    const current = res.temperature?.[0]?.current;
    const currentNum = current === undefined ? NaN : parseFloat(current);
    if (current === undefined || !Number.isFinite(currentNum)) {
      this.log.warn(`ACB poll: temperature[0].current missing or non-numeric for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, this.notResponding());
    } else {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, currentNum);
    }

    const desired = res.temperature?.[0]?.desired;
    const desiredNum = desired === undefined ? NaN : parseFloat(desired);
    if (desired === undefined || !Number.isFinite(desiredNum)) {
      this.log.warn(`ACB poll: temperature[0].desired missing or non-numeric for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.CoolingThresholdTemperature, this.notResponding());
    } else {
      this.service.updateCharacteristic(Characteristic.CoolingThresholdTemperature, desiredNum);
    }
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
      this.log.warn(`ACB Active onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`ACB Active onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }

  private async handleTargetStateSet(_value: CharacteristicValue): Promise<void> {
    // validValues is locked to [COOL]; HomeKit will not request any other
    // mode. Treat as a no-op rather than issuing a redundant command.
  }

  private async handleCoolingThresholdSet(value: CharacteristicValue): Promise<void> {
    const ctx = this.context();
    const desired = Number(value).toFixed(0);

    let result;
    try {
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'temperature', attribute: 'desired', value: desired },
      ]);
    } catch (err) {
      this.log.warn(
        `ACB CoolingThresholdTemperature onSet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`,
      );
      throw this.notResponding();
    }

    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(
        `ACB CoolingThresholdTemperature onSet reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`,
      );
      throw this.notResponding();
    }
  }
}
