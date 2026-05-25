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
import type { PollableHandler } from '../poller.js';

const MANUFACTURER = 'Hi-oT (Hyundai Autoever)';

/**
 * Maps a Hi-oT HTR (heating) device to a HomeKit Thermostat service.
 *
 * Reads happen through the platform's background poller, which calls
 * {@link ThermostatAccessory.updateState} on each tick. Writes hit the
 * backend immediately via `client.exeDeviceBatch`.
 *
 * Intentional first-cut limits:
 *   - integer °C only (15–30, minStep 1)
 *   - HEAT and OFF target modes only (COOL/AUTO not supported)
 *
 * The exeDeviceBatch attribute for setting the desired temperature is inferred
 * (`resource: 'temperature', attribute: 'desired'`); confirm against a capture
 * before relying on it in mission-critical scenarios.
 */
export class ThermostatAccessory implements PollableHandler {
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
      this.accessory.getService(HapService.Thermostat) ??
      this.accessory.addService(HapService.Thermostat);

    this.service
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: 15, maxValue: 30, minStep: 1 })
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          Characteristic.TargetHeatingCoolingState.OFF,
          Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private parseTemperature(raw: string | undefined): number | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  updateState(res: DeviceResponse): void {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();

    const current = this.parseTemperature(res.temperature?.[0]?.current);
    if (current === undefined) {
      this.log.warn(`HTR poll: current temperature missing/invalid for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, this.notResponding());
    } else {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, current);
    }

    const desired = this.parseTemperature(res.temperature?.[0]?.desired);
    if (desired === undefined) {
      this.log.warn(`HTR poll: target temperature missing/invalid for devicetypecd=${ctx.devicetypecd}`);
      this.service.updateCharacteristic(Characteristic.TargetTemperature, this.notResponding());
    } else {
      this.service.updateCharacteristic(Characteristic.TargetTemperature, desired);
    }

    const power = res.operation?.[0]?.power;
    if (power === undefined) {
      this.log.warn(`HTR poll: power field missing for devicetypecd=${ctx.devicetypecd}`);
      const err = this.notResponding();
      this.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, err);
      this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, err);
    } else {
      this.service.updateCharacteristic(
        Characteristic.CurrentHeatingCoolingState,
        power === 'on'
          ? Characteristic.CurrentHeatingCoolingState.HEAT
          : Characteristic.CurrentHeatingCoolingState.OFF,
      );
      this.service.updateCharacteristic(
        Characteristic.TargetHeatingCoolingState,
        power === 'on'
          ? Characteristic.TargetHeatingCoolingState.HEAT
          : Characteristic.TargetHeatingCoolingState.OFF,
      );
    }
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
