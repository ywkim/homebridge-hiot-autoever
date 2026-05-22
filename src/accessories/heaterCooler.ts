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

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';

const COOL_THRESHOLD_MIN = 18;
const COOL_THRESHOLD_MAX = 30;
const COOL_THRESHOLD_STEP = 1;

/**
 * Maps a Hi-oT ACB (air conditioner) device to a HomeKit HeaterCooler service.
 *
 * Scope (this PR): Active, CurrentTemperature, CurrentHeaterCoolerState,
 * TargetHeaterCoolerState (locked to COOL), CoolingThresholdTemperature.
 * Fan speed / swing / HEAT|AUTO modes / 0.5°C precision are deferred.
 *
 * The `temperature[0].desired` write attribute is empirically inferred from
 * Hi-oT app behavior and may need adjustment after capture validation.
 */
export class HeaterCoolerAccessory {
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
      this.accessory.getService(HapService.HeaterCooler) ??
      this.accessory.addService(HapService.HeaterCooler);

    this.service
      .getCharacteristic(Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service
      .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.handleCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: COOL_THRESHOLD_MIN,
        maxValue: COOL_THRESHOLD_MAX,
        minStep: COOL_THRESHOLD_STEP,
      })
      .onGet(this.handleCoolingThresholdGet.bind(this))
      .onSet(this.handleCoolingThresholdSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async fetchDevice(label: string): Promise<DeviceResponse> {
    const ctx = this.context();
    try {
      return await this.client.getDevice(ctx.devicecd);
    } catch (err) {
      this.log.warn(`ACB ${label} failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
  }

  private requirePower(res: DeviceResponse, label: string): string {
    const ctx = this.context();
    const power = res.operation?.[0]?.power;
    if (power === undefined) {
      this.log.warn(`ACB ${label}: operation[0].power missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return power;
  }

  private async handleActiveGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const res = await this.fetchDevice('Active onGet');
    const power = this.requirePower(res, 'Active onGet');
    return power === 'on' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
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

  private async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const ctx = this.context();
    const res = await this.fetchDevice('CurrentTemperature onGet');
    const raw = res.temperature?.[0]?.current;
    if (raw === undefined) {
      this.log.warn(`ACB CurrentTemperature onGet: temperature[0].current missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      this.log.warn(`ACB CurrentTemperature onGet: non-numeric value "${raw}" for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return parsed;
  }

  private async handleCurrentStateGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const res = await this.fetchDevice('CurrentHeaterCoolerState onGet');
    const power = this.requirePower(res, 'CurrentHeaterCoolerState onGet');
    return power === 'on'
      ? Characteristic.CurrentHeaterCoolerState.COOLING
      : Characteristic.CurrentHeaterCoolerState.INACTIVE;
  }

  private async handleTargetStateGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    return Characteristic.TargetHeaterCoolerState.COOL;
  }

  private async handleTargetStateSet(_value: CharacteristicValue): Promise<void> {
    // validValues is locked to [COOL]; HomeKit will not request any other
    // mode. Treat as a no-op rather than issuing a redundant command.
  }

  private async handleCoolingThresholdGet(): Promise<CharacteristicValue> {
    const ctx = this.context();
    const res = await this.fetchDevice('CoolingThresholdTemperature onGet');
    const raw = res.temperature?.[0]?.desired;
    if (raw === undefined) {
      this.log.warn(`ACB CoolingThresholdTemperature onGet: temperature[0].desired missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      this.log.warn(`ACB CoolingThresholdTemperature onGet: non-numeric value "${raw}" for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return parsed;
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
