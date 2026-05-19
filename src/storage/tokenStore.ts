import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const TOKEN_FILE_NAME = 'hiot-autoever-token.json';
const FILE_MODE = 0o600;

interface PersistedShape {
  userKeyValu?: string;
}

/**
 * Persists the server-issued `userkeyvalu` token to disk so the plugin can
 * skip the plaintext-password login path on subsequent Homebridge restarts.
 *
 * The token is stored as opaque JSON at `<storagePath>/hiot-autoever-token.json`
 * with file mode 0600. Corrupted or missing files resolve to `undefined`
 * (the caller falls back to plaintext login).
 */
export class TokenStore {
  private readonly filePath: string;

  constructor(storagePath: string) {
    this.filePath = join(storagePath, TOKEN_FILE_NAME);
  }

  async load(): Promise<string | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedShape;
      const token = parsed.userKeyValu;
      return typeof token === 'string' && token.length > 0 ? token : undefined;
    } catch {
      return undefined;
    }
  }

  async save(token: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: PersistedShape = { userKeyValu: token };
    await writeFile(this.filePath, JSON.stringify(payload), {
      encoding: 'utf8',
      mode: FILE_MODE,
    });
  }
}
