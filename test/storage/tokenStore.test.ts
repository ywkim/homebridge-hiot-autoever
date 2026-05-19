import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TokenStore } from '../../src/storage/tokenStore.js';

describe('TokenStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hiot-token-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined when storage directory has no token file', async () => {
    const store = new TokenStore(join(dir, 'does-not-exist'));
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('returns undefined when storage directory exists but file missing', async () => {
    const store = new TokenStore(dir);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('save then load returns same token', async () => {
    const store = new TokenStore(dir);
    await store.save('TOKEN_ABC');
    await expect(store.load()).resolves.toBe('TOKEN_ABC');
  });

  it('save creates the storage directory if missing', async () => {
    const nested = join(dir, 'nested', 'deeper');
    const store = new TokenStore(nested);
    await store.save('T');
    await expect(store.load()).resolves.toBe('T');
  });

  it('returns undefined on corrupted JSON instead of throwing', async () => {
    const store = new TokenStore(dir);
    await store.save('initial');
    await writeFile(join(dir, 'hiot-autoever-token.json'), '{not-json', 'utf8');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('returns undefined when JSON is well-formed but token field missing', async () => {
    const store = new TokenStore(dir);
    await writeFile(join(dir, 'hiot-autoever-token.json'), '{"other":"value"}', 'utf8');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('writes file with mode 0600', async () => {
    const store = new TokenStore(dir);
    await store.save('SENSITIVE');
    const st = await stat(join(dir, 'hiot-autoever-token.json'));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('overwrites existing token on subsequent save', async () => {
    const store = new TokenStore(dir);
    await store.save('first');
    await store.save('second');
    await expect(store.load()).resolves.toBe('second');
  });
});
