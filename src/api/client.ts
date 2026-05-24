import { fetch, type Dispatcher } from 'undici';
import { CookieJar } from 'tough-cookie';

import { HiotApiError, HiotAuthError, HiotConnectionError } from './errors.js';
import type {
  DeviceBatchResponse,
  DeviceCommand,
  DeviceListResponse,
  DeviceResponse,
  LoginCondition,
  LoginResponse,
} from './types.js';

const DEFAULT_APP_TYPE_CD = 'HIOT';
const DEFAULT_OS_TYPE = 'ios';
const SESSION_COOKIE_NAME = 'JSESSIONID_HIOTWEB';

const LOGIN_PATH = '/hiot-web/login/exelogin';
const DEVICE_LIST_PATH = '/hiot-web/device/getdevicelist';
const DEVICE_GET_PATH = '/hiot-web/device/getdevice';
const DEVICE_BATCH_PATH = '/hiot-web/device/exedevicebatchv2';
const CALL_ELEVATOR_PATH = '/hiot-web/homenet/execallelevator';

export interface HiotClientLogger {
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface HiotClientOptions {
  /** e.g. `https://home.hiot.autoever.com:8443` (no trailing slash required). */
  baseUrl: string;
  userid: string;
  password: string;
  /** Cached server-issued token from a previous login (auto-login fast path). */
  initialUserKeyValu?: string;
  pushRegistrationToken?: string;
  mobileDeviceOsType?: string;
  appTypeCd?: string;
  logger?: HiotClientLogger;
  /** Optional undici Dispatcher (e.g. MockAgent in tests). */
  dispatcher?: Dispatcher;
  /**
   * Called every time the client receives a fresh `userkeyvalu` from the server.
   * The platform layer can persist it to disk so the next plugin start
   * skips the plaintext-password login path.
   */
  onTokenUpdate?: (token: string) => void;
}

interface RawResponse {
  status: number;
  text: string;
}

export class HiotClient {
  private readonly cookieJar = new CookieJar();
  private readonly baseUrl: string;
  private readonly userid: string;
  private readonly password: string;
  private readonly appTypeCd: string;
  private readonly mobileDeviceOsType: string;
  private readonly pushRegistrationToken?: string;
  private readonly logger?: HiotClientLogger;
  private readonly dispatcher?: Dispatcher;
  private readonly onTokenUpdate?: (token: string) => void;

  private userKeyValu: string | undefined;

  /** In-flight login promise, used to coalesce concurrent login attempts. */
  private loginInFlight: Promise<LoginResponse> | undefined;

  constructor(options: HiotClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.userid = options.userid;
    this.password = options.password;
    this.appTypeCd = options.appTypeCd ?? DEFAULT_APP_TYPE_CD;
    this.mobileDeviceOsType = options.mobileDeviceOsType ?? DEFAULT_OS_TYPE;
    this.pushRegistrationToken = options.pushRegistrationToken;
    this.logger = options.logger;
    this.dispatcher = options.dispatcher;
    this.onTokenUpdate = options.onTokenUpdate;
    this.userKeyValu = options.initialUserKeyValu;
  }

  /** Currently cached server-issued token, if any. */
  getUserKeyValu(): string | undefined {
    return this.userKeyValu;
  }

  /**
   * Force a login round-trip. Uses the cached `userkeyvalu` if present;
   * otherwise falls back to plaintext password.
   */
  async login(): Promise<LoginResponse> {
    return this.doLogin(false);
  }

  async getDeviceList(): Promise<DeviceListResponse> {
    return this.authedJsonRequest<DeviceListResponse>(DEVICE_LIST_PATH, {});
  }

  async getDevice(devicecd: string): Promise<DeviceResponse> {
    return this.authedJsonRequest<DeviceResponse>(DEVICE_GET_PATH, {
      device: { devicecd },
    });
  }

  async exeDeviceBatch(commands: DeviceCommand[]): Promise<DeviceBatchResponse> {
    const raw = await this.authedJsonRequest<unknown>(DEVICE_BATCH_PATH, {
      device: commands,
    });
    // Validate the summary shape rather than trusting JSON parse alone. A 200 +
    // valid-JSON response with `device` missing or `device[0].fail` non-numeric
    // would otherwise be coerced to `fail=0` by downstream handlers and silently
    // mask backend failures. Surface those as errors so handlers map them to
    // Not Responding via their existing try/catch.
    const device = (raw as { device?: unknown } | null)?.device;
    if (
      !Array.isArray(device) ||
      device.length < 1 ||
      typeof (device[0] as { fail?: unknown })?.fail !== 'number'
    ) {
      // Do not embed the response body in the error message — mirrors the
      // parseSuccess convention so credentials/session ids in error payloads
      // never leak via error.message. Raw body attached as cause for debugging.
      throw new HiotApiError('exeDeviceBatch response malformed', raw);
    }
    return raw as DeviceBatchResponse;
  }

  /**
   * Fire-and-forget elevator call (Hi-oT "EV호출" / 엘리베이터 호출).
   *
   * Unlike the device endpoints, this is an empty-body POST and the backend
   * replies with HTTP 200 and an empty body — there is no status payload to
   * parse and no server-side result signal. We only validate the status code
   * and reuse the same 401 re-login flow as {@link authedJsonRequest}.
   */
  async callElevator(): Promise<void> {
    await this.ensureAuthenticated();
    let raw = await this.rawEmptyRequest(CALL_ELEVATOR_PATH);
    if (raw.status === 401) {
      this.logger?.warn(`401 on ${CALL_ELEVATOR_PATH}; re-authenticating with plaintext`);
      await this.cookieJar.removeAllCookies();
      this.userKeyValu = undefined;
      await this.doLogin(true);
      raw = await this.rawEmptyRequest(CALL_ELEVATOR_PATH);
    }
    if (raw.status === 401) {
      throw new HiotAuthError(`unauthorized on ${CALL_ELEVATOR_PATH}`);
    }
    if (raw.status < 200 || raw.status >= 300) {
      // Do not embed the response body in the error message — mirrors the
      // parseSuccess convention so any sensitive fields never leak via
      // error.message. Raw body attached as cause for debugging.
      throw new HiotApiError(`HTTP ${raw.status} on ${CALL_ELEVATOR_PATH}`, raw.text || undefined);
    }
  }

  private doLogin(forcePlaintext: boolean): Promise<LoginResponse> {
    // Coalesce concurrent logins: if another caller is already authenticating,
    // wait for that result instead of issuing a duplicate request. This keeps
    // burst startup polls (e.g. fetching state for many devices in parallel)
    // from hitting the upstream auth endpoint repeatedly.
    if (this.loginInFlight) {
      return this.loginInFlight;
    }
    const p = this.performLogin(forcePlaintext).finally(() => {
      this.loginInFlight = undefined;
    });
    this.loginInFlight = p;
    return p;
  }

  private async performLogin(forcePlaintext: boolean): Promise<LoginResponse> {
    const useToken = !forcePlaintext && Boolean(this.userKeyValu);
    const condition: LoginCondition = {
      apptypecd: this.appTypeCd,
      userid: this.userid,
      mobiledeviceostype: this.mobileDeviceOsType,
    };
    if (this.pushRegistrationToken) {
      condition.pushregistrationtoken = this.pushRegistrationToken;
    }
    if (useToken) {
      condition.userkeyvalu = this.userKeyValu;
    } else {
      condition.passwordvalu = this.password;
    }

    const raw = await this.rawRequest(LOGIN_PATH, { condition });
    if (raw.status === 401 && useToken) {
      // Cached token rejected — retry with plaintext within the same in-flight
      // login (calling doLogin would deadlock by awaiting itself).
      this.logger?.warn('cached token rejected on login; retrying with plaintext');
      this.userKeyValu = undefined;
      return this.performLogin(true);
    }
    const data = this.parseSuccess<LoginResponse>(raw, 'login');
    const token = data.login?.[0]?.userkeyvalu;
    if (!token) {
      throw new HiotAuthError('login response missing userkeyvalu');
    }
    this.userKeyValu = token;
    this.onTokenUpdate?.(token);
    this.logger?.debug(`login ok (autoLogin=${useToken})`);
    return data;
  }

  private async authedJsonRequest<T>(path: string, body: unknown): Promise<T> {
    await this.ensureAuthenticated();
    let raw = await this.rawRequest(path, body);
    if (raw.status === 401) {
      this.logger?.warn(`401 on ${path}; re-authenticating with plaintext`);
      await this.cookieJar.removeAllCookies();
      this.userKeyValu = undefined;
      await this.doLogin(true);
      raw = await this.rawRequest(path, body);
    }
    return this.parseSuccess<T>(raw, path);
  }

  private async ensureAuthenticated(): Promise<void> {
    const cookies = await this.cookieJar.getCookies(this.baseUrl);
    const hasSession = cookies.some((c) => c.key === SESSION_COOKIE_NAME);
    if (!hasSession) {
      await this.doLogin(false);
    }
  }

  private async rawRequest(path: string, body: unknown): Promise<RawResponse> {
    return this.sendPost(path, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** POST with an empty body — used by fire-and-forget endpoints like callElevator. */
  private async rawEmptyRequest(path: string): Promise<RawResponse> {
    return this.sendPost(path, { headers: {}, body: '' });
  }

  private async sendPost(
    path: string,
    init: { headers: Record<string, string>; body: string },
  ): Promise<RawResponse> {
    const url = `${this.baseUrl}${path}`;
    const cookieHeader = await this.cookieJar.getCookieString(url);
    const headers: Record<string, string> = { ...init.headers };
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: init.body,
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      throw new HiotConnectionError(`request to ${path} failed`, err);
    }

    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      try {
        await this.cookieJar.setCookie(sc, url);
      } catch (err) {
        this.logger?.warn(`failed to store cookie from ${path}: ${(err as Error).message}`);
      }
    }

    const text = await response.text();
    return { status: response.status, text };
  }

  private parseSuccess<T>(raw: RawResponse, label: string): T {
    if (raw.status === 401) {
      throw new HiotAuthError(`unauthorized on ${label}`);
    }
    if (raw.status < 200 || raw.status >= 300) {
      // Do not embed the response body in the error message — the backend may
      // include sensitive fields (userkeyvalu, session ids) in error payloads,
      // which would then leak via any upstream logger of error.message.
      // The raw body is attached as the error cause for debugging instead.
      throw new HiotApiError(`HTTP ${raw.status} on ${label}`, raw.text || undefined);
    }
    if (!raw.text) {
      // Hi-oT data endpoints always return a JSON object. An empty body
      // would silently coerce to `{}` and crash downstream property access,
      // so surface it as an error.
      throw new HiotApiError(`empty response body from ${label}`);
    }
    try {
      return JSON.parse(raw.text) as T;
    } catch (err) {
      throw new HiotApiError(`invalid JSON from ${label}`, err);
    }
  }
}
