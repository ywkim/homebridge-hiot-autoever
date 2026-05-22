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

// TODO: verify against mini.local capture. The Hi-oT app exposes a gas-valve
// lock/unlock toggle, but the on-the-wire `operation[0].power` token has not
// been captured yet. We assume the same vocabulary as LGT (`on`/`off`) and
// also tolerate `lock`/`closed` and `unlock`/`open` in case the backend uses
// valve-specific terms. Adjust the mappings once a live response is observed.
const SECURED_TOKENS = new Set(['on', 'lock', 'locked', 'closed', 'close']);
const UNSECURED_TOKENS = new Set(['off', 'unlock', 'unlocked', 'open']);

// TODO: verify against mini.local. We send the LGT-style `on`/`off` token;
// `lock`/`unlock` is an alternative observed in some Hi-oT command schemas.
const SECURED_WRITE_VALUE = 'on';
const UNSECURED_WRITE_VALUE = 'off';

/**
 * Maps a Hi-oT GDK (gas-valve) device to a HomeKit LockMechanism service.
 *
 * Per CLAUDE.md "노출 원칙": the plugin mirrors the Hi-oT app 1:1. The Hi-oT
 * app exposes both lock and unlock for the gas valve, so this handler exposes
 * both with no safety guards — the user owns the safety contract, just as
 * they do in the Hi-oT app itself.
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
      .onGet(this.handleCurrentStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));
  }

  private context(): HiotAccessoryContext {
    return this.accessory.context as HiotAccessoryContext;
  }

  private notResponding(): Error {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async handleCurrentStateGet(): Promise<CharacteristicValue> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();

    let power: string | undefined;
    try {
      const res = await this.client.getDevice(ctx.devicecd);
      power = res.operation?.[0]?.power;
    } catch (err) {
      this.log.warn(`GDK onGet failed for devicetypecd=${ctx.devicetypecd}: ${(err as Error).message}`);
      throw this.notResponding();
    }
    if (power === undefined) {
      this.log.warn(`GDK onGet: power field missing for devicetypecd=${ctx.devicetypecd}`);
      throw this.notResponding();
    }
    const token = power.toLowerCase();
    if (SECURED_TOKENS.has(token)) {
      return Characteristic.LockCurrentState.SECURED;
    }
    if (UNSECURED_TOKENS.has(token)) {
      return Characteristic.LockCurrentState.UNSECURED;
    }
    this.log.warn(`GDK onGet: unknown power token "${power}" for devicetypecd=${ctx.devicetypecd}`);
    throw this.notResponding();
  }

  private async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.api.hap;
    const ctx = this.context();
    const secured = value === Characteristic.LockTargetState.SECURED;
    const writeValue = secured ? SECURED_WRITE_VALUE : UNSECURED_WRITE_VALUE;

    let result;
    try {
      result = await this.client.exeDeviceBatch([
        { devicecd: ctx.devicecd, resource: 'operation', attribute: 'power', value: writeValue },
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
