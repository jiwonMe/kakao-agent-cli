import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Long } from 'bson';
import { FileVault } from './vault.mjs';
import { providerCacheDir } from './paths.mjs';

export const SUPPORTED_VERSION = '2.37.1';

export function fail(code, message = code) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function validId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) fail('INVALID_ID');
  if (BigInt(value) > 9223372036854775807n) fail('INVALID_ID');
  return value;
}

export function validAccount(account) {
  if (
    !account ||
    typeof account.oauth_token !== 'string' ||
    !account.oauth_token ||
    typeof account.device_uuid !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(account.device_uuid) ||
    !['pc', 'tablet'].includes(account.device_type)
  ) {
    fail('INVALID_CREDENTIALS');
  }
  validId(account.user_id);
  if (BigInt(account.user_id) > BigInt(Number.MAX_SAFE_INTEGER)) fail('UNSUPPORTED_USER_ID');
  return account;
}

/** Resolve agent-messenger@2.37.1 and load agent-messenger/kakaotalk. */
export async function loadProvider() {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('agent-messenger/package.json');
    const metadata = JSON.parse(await readFile(pkgPath, 'utf8'));
    if (metadata.version !== SUPPORTED_VERSION) fail('PROVIDER_VERSION_MISMATCH');
    return await import('agent-messenger/kakaotalk');
  } catch (e) {
    if (e.code === 'PROVIDER_VERSION_MISMATCH') throw e;
    fail('PROVIDER_NOT_INSTALLED');
  }
}

export async function resolveProviderInfo() {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('agent-messenger/package.json');
    const metadata = JSON.parse(await readFile(pkgPath, 'utf8'));
    return {
      resolvable: true,
      version: metadata.version,
      path: pkgPath,
      expected: SUPPORTED_VERSION,
      match: metadata.version === SUPPORTED_VERSION,
    };
  } catch {
    return {
      resolvable: false,
      version: null,
      path: null,
      expected: SUPPORTED_VERSION,
      match: false,
    };
  }
}

/** Thin KakaoTalk client around agent-messenger/kakaotalk. */
export class Client {
  constructor({ client, identity, deviceType }) {
    this.client = client;
    this.identity = validId(identity);
    this.deviceType = deviceType ?? 'tablet';
  }

  static async connect({ account, stateDir, provider }) {
    validAccount(account);
    const sdk = provider ?? (await loadProvider());
    const cacheDir = providerCacheDir();
    const dir = stateDir ? `${stateDir}/provider-cache` : cacheDir;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    process.env.AGENT_MESSENGER_CONFIG_DIR = dir;

    const client = new sdk.KakaoTalkClient();
    try {
      await client.login({
        oauthToken: account.oauth_token,
        userId: account.user_id,
        deviceUuid: account.device_uuid,
        deviceType: account.device_type,
      });
      await client.acquireSession();
      return new Client({
        client,
        identity: account.user_id,
        deviceType: account.device_type,
      });
    } catch (e) {
      client.close();
      fail('PROVIDER_LOGIN_FAILED', e?.message || 'login failed');
    }
  }

  async listChats(search) {
    return this.client.getChats({ all: true, search, resolveTitles: true });
  }

  async getChat(chatId) {
    return this.client.getChat(validId(chatId));
  }

  async getHistory(chatId, options = {}) {
    const count = options.count ?? 30;
    if (!Number.isInteger(count) || count < 1 || count > 200) fail('INVALID_COUNT');
    validId(chatId);
    return this.client.getMessages(chatId, { count });
  }

  /** One-shot text send via raw session (no high-level retry). */
  async sendTextOnce(chatId, text) {
    validId(chatId);
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4000) {
      fail('INVALID_TEXT');
    }
    const session = await this.client.acquireSession();
    return session.sendMessage(Long.fromString(chatId), text);
  }

  close() {
    this.client.close();
  }
}

/** Login via loginFlow and persist credentials to FileVault. */
export async function loginAndStore({
  email,
  password,
  deviceType = 'tablet',
  force = false,
  vault,
  provider,
  onPasscodeDisplay,
}) {
  if (typeof email !== 'string' || !email.includes('@')) fail('INVALID_LOGIN_INPUT');
  if (typeof password !== 'string' || !password) fail('INVALID_LOGIN_INPUT');
  if (!['pc', 'tablet'].includes(deviceType)) fail('INVALID_DEVICE_TYPE');

  const sdk = provider ?? (await loadProvider());
  const store = vault ?? new FileVault();
  const existing = await store.getAccount();

  const result = await sdk.loginFlow({
    email,
    password,
    deviceType,
    force,
    savedDeviceUuid: existing?.device_uuid,
    onPasscodeDisplay:
      onPasscodeDisplay ||
      ((code) => {
        process.stderr.write(`[kakao-agent] Confirm this code on your phone: ${code}\n`);
      }),
  });

  if (!result?.authenticated || !result.credentials) {
    return {
      authenticated: false,
      next_action: result?.next_action ?? null,
      error: result?.error ?? 'LOGIN_REJECTED',
      message: result?.message ?? 'Login did not produce credentials',
      warning: result?.warning,
    };
  }

  const creds = result.credentials;
  const account = validAccount({
    oauth_token: creds.access_token,
    refresh_token: creds.refresh_token || '',
    user_id: creds.user_id,
    device_uuid: creds.device_uuid,
    device_type: creds.device_type || deviceType,
  });

  await store.setAccount(account);
  return {
    authenticated: true,
    user_id: account.user_id,
    device_type: account.device_type,
    vault: 'file',
  };
}

export async function authStatus(vault = new FileVault()) {
  const account = await vault.getAccount();
  if (!account) return { authenticated: false, vault: 'file' };
  return {
    authenticated: true,
    user_id: account.user_id,
    device_type: account.device_type,
    device_uuid_prefix: typeof account.device_uuid === 'string' ? account.device_uuid.slice(0, 8) : null,
    has_refresh_token: Boolean(account.refresh_token),
    vault: 'file',
  };
}

export async function authLogout(vault = new FileVault()) {
  await vault.deleteAccount();
  return { local_credentials_deleted: true, server_session_revoked: false, vault: 'file' };
}
