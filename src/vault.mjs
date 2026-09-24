import { mkdir, readFile, unlink, chmod, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { credentialsPath } from './paths.mjs';

function fail(code, message = code) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * File-based credential vault (no Keychain).
 * Stores account JSON at configDir/credentials.json with mode 0o600.
 */
export class FileVault {
  /** @param {{ path?: string }} [options] */
  constructor(options = {}) {
    this.path = options.path || credentialsPath();
  }

  async _ensureDir() {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try { await chmod(dir, 0o700); } catch { /* Windows may ignore chmod */ }
  }

  async _readStore() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) fail('VAULT_CORRUPT');
      return parsed;
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      if (e.code === 'VAULT_CORRUPT') throw e;
      if (e instanceof SyntaxError) fail('VAULT_CORRUPT');
      fail('VAULT_UNAVAILABLE', e.message);
    }
  }

  async _writeStore(store) {
    await this._ensureDir();
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(tmp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(store, null, 2), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(tmp, this.path);
      try { await chmod(this.path, 0o600); } catch { /* Windows may ignore chmod */ }
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      await unlink(tmp).catch(() => {});
      fail('VAULT_UNAVAILABLE', e.message);
    }
  }

  async getAccount() {
    const store = await this._readStore();
    const account = store.account;
    if (account === undefined) return null;
    if (!isPlainObject(account)) fail('VAULT_CORRUPT');
    return { ...account };
  }

  async setAccount(account) {
    if (!isPlainObject(account)) fail('INVALID_CREDENTIALS');
    const store = await this._readStore();
    store.account = { ...account };
    await this._writeStore(store);
  }

  async deleteAccount() {
    const store = await this._readStore();
    if (store.account === undefined) return false;
    delete store.account;
    if (Object.keys(store).length === 0) {
      try { await unlink(this.path); } catch (e) {
        if (e.code !== 'ENOENT') fail('VAULT_UNAVAILABLE', e.message);
      }
      return true;
    }
    await this._writeStore(store);
    return true;
  }

  async get(key = 'account') {
    if (key !== 'account') fail('INVALID_KEY');
    return this.getAccount();
  }

  async set(key, value) {
    if (key !== 'account') fail('INVALID_KEY');
    return this.setAccount(value);
  }

  async delete(key = 'account') {
    if (key !== 'account') fail('INVALID_KEY');
    return this.deleteAccount();
  }
}

export { fail as vaultFail };
