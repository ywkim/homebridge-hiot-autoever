import type {
  API,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { HiotClient } from '../api/client.js';
import type { DeviceCommand, DeviceResponse } from '../api/types.js';
import type { HiotAccessoryContext } from '../platform.js';

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';

/**
 * Maps a Hi-oT HTR (heating) device to a HomeKit Thermostat service.
 *
 * Reads `temperature[0].current/desired` and `operation[0].power` from
 * `client.getDevice` and writes back via `client.exeDeviceBatch`.
 *
 * Intentional first-cut limits:
 *   - integer °C only (15–30, minStep 1)
 *   - HEAT and OFF target modes only (COOL/AUTO not supported)
 *
 * The exeDeviceBatch attribute for setting the desired temperature is inferred
 * (`resource: 'temperature', attribute: 'desired'`); confirm against a capture
 * before relying on it in mission-critical scenarios.
 */
export class ThermostatAccessory {
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
      this.accessory.getService(HapService.Thermostat) ??
      this.accessory.addService(HapService.Thermostat);

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: 15, maxValue: 30, minStep: 1 })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          Characteristic.TargetHeatingCoolingState.OFF,
          Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async fetchState(): Promise<DeviceResponse> {
    const ctx = this.context();
    try {
      return await this.client.getDevice(ctx.devicecd);
    } catch (err) {
      this.log.warn(`HTR getDevice failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
  }

  private parseTemperature(raw: string | undefined, label: string): number {
    const ctx = this.context();
    if (raw === undefined) {
      this.log.warn(`HTR ${label} field missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) {
      this.log.warn(`HTR ${label} field not numeric ("${raw}") for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return n;
  }

  private powerToHeatingState(power: string | undefined, label: string): 'on' | 'off' {
    const ctx = this.context();
    if (power === undefined) {
      this.log.warn(`HTR ${label}: power field missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    return power === 'on' ? 'on' : 'off';
  }

  private async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const res = await this.fetchState();
    return this.parseTemperature(res.temperature?.[0]?.current, 'current temperature');
  }

  private async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    const res = await this.fetchState();
    return this.parseTemperature(res.temperature?.[0]?.desired, 'target temperature');
  }

  private async handleCurrentHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const res = await this.fetchState();
    const power = this.powerToHeatingState(res.operation?.[0]?.power, 'current state');
    return power === 'on'
      ? Characteristic.CurrentHeatingCoolingState.HEAT
      : Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private async handleTargetHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const res = await this.fetchState();
    const power = this.powerToHeatingState(res.operation?.[0]?.power, 'target state');
    return power === 'on'
      ? Characteristic.TargetHeatingCoolingState.HEAT
      : Characteristic.TargetHeatingCoolingState.OFF;
  }

  private async handleTargetTemperatureSet(value: CharacteristicValue): Promise<void> {
    const ctx = this.context();
    // TODO: `resource: 'temperature', attribute: 'desired'` is inferred from
    // the getdevice response shape — confirm against a Hi-oT capture of the
    // wallpad setting a thermostat target.
    const desired = Number(value).toFixed(0);
    await this.commit(
      [{ devicecd: ctx.devicecd, resource: 'temperature', attribute: 'desired', value: desired }],
      'target temperature',
    );
  }

  private async handleTargetHeatingCoolingStateSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    const numeric = Number(value);
    let power: string;
    if (numeric === Characteristic.TargetHeatingCoolingState.HEAT) {
      power = 'on';
    } else if (numeric === Characteristic.TargetHeatingCoolingState.OFF) {
      power = 'off';
    } else {
      this.log.warn(`HTR unsupported target mode ${numeric} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    await this.commit(
      [{ devicecd: ctx.devicecd, resource: 'operation', attribute: 'power', value: power }],
      'target mode',
    );
  }

  private async commit(commands: DeviceCommand[], label: string): Promise<void> {
    const ctx = this.context();
    let result;
    try {
      result = await this.client.exeDeviceBatch(commands);
    } catch (err) {
      this.log.warn(`HTR ${label} set failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
    const fail = result.device?.[0]?.fail ?? 0;
    if (fail > 0) {
      this.log.warn(`HTR ${label} set reported fail=${fail} for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
  }
}
