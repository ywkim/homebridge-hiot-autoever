/**
 * Hi-oT REST API request/response shapes.
 *
 * Source: empirical mitmproxy capture against the Hi-oT backend.
 * Fields are deliberately permissive — backend may emit additional keys we
 * don't model yet; consumers should treat unknown fields as opaque.
 */

export interface LoginCondition {
  apptypecd: string;
  userid: string;
  mobiledeviceostype: string;
  pushregistrationtoken?: string;
  /** Plaintext password — only used on first login. */
  passwordvalu?: string;
  /** Server-issued opaque token — used for subsequent auto-login. */
  userkeyvalu?: string;
}

export interface LoginRequest {
  condition: LoginCondition;
}

export interface LoginUser {
  userid: string;
  householdcd: string;
  userkeyvalu: string;
  nicknm?: string;
  isverified?: string;
  webversion?: string;
  webinitpageurl?: string;
}

export interface LoginComplex {
  complextitlenm?: string;
  complexnm?: string;
  complextypecd?: string;
  complextitleimgpath?: string;
}

export interface LoginResponse {
  login: LoginUser[];
  complex: LoginComplex[];
}

export interface Device {
  devicecd: string;
  devicetypecd: string;
  devicenm: string;
  spacenm?: string;
  spacesq?: number;
  spacetypecd?: string;
  nodecd?: string;
  placementidx?: number;
  attributevalu?: string;
  devicemodelcd?: string;
  devicetypenm?: string;
}

export interface DeviceListResponse {
  device: Device[];
}

export interface TemperatureState {
  current?: string;
  desired?: string;
  maxvalu?: string;
  minvalu?: string;
  valuenm?: string;
}

export interface OperationState {
  power?: string;
  valuenm?: string;
}

export interface DeviceStateDetail {
  complexcd?: string;
  connected?: string;
  partneraccountcd?: string;
  spacetypecd?: string;
  devicetypecd?: string;
  partnerclientcd?: string;
  householdcd?: string;
  devicecd?: string;
}

export interface DeviceResponse {
  temperature?: TemperatureState[];
  operation?: OperationState[];
  device?: DeviceStateDetail[];
}

export interface DeviceCommand {
  devicecd: string;
  resource: string;
  attribute: string;
  value: string;
}

export interface DeviceBatchRequest {
  device: DeviceCommand[];
}

export interface DeviceBatchSummary {
  all: number;
  success: number;
  fail: number;
}

export interface DeviceBatchResponse {
  message: unknown[];
  device: DeviceBatchSummary[];
}
