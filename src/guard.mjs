import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { previewsDir } from './paths.mjs';

const TTL_MS = 600_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fail(code, message = code) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function validChatId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) fail('INVALID_ID');
  if (BigInt(value) > 9223372036854775807n) fail('INVALID_ID');
  return value;
}

function fingerprint(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

async function syncDir(dir) {
  const handle = await fs.open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(tmp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
    await syncDir(path.dirname(file));
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
  }
}

/**
 * Preview reservation / one-shot send guard.
 * Preview JSON under stateDir/previews/ with exclusive create.
 */
export class SendGuard {
  constructor(options = {}) {
    this.stateDir = path.resolve(options.stateDir || previewsDir());
    this.transport = options.transport ?? null;
    this.now = options.now || Date.now;
  }

  async _ensureDir() {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try { await fs.chmod(this.stateDir, 0o700); } catch { /* Windows */ }
  }

  _file(previewId, kind) {
    if (typeof previewId !== 'string' || !UUID_RE.test(previewId)) fail('INVALID_PREVIEW_ID');
    return path.join(this.stateDir, `${previewId}.${kind}.json`);
  }

  _identity() {
    const id = this.transport?.identity;
    if (typeof id !== 'string' || !id.trim()) fail('INVALID_ACCOUNT');
    return id;
  }

  _time() {
    const n = Number(this.now());
    if (!Number.isFinite(n)) fail('INVALID_CLOCK');
    return n;
  }

  async _read(file, missingCode) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e) {
      fail(e.code === 'ENOENT' ? missingCode : 'STATE_UNAVAILABLE');
    }
  }

  async _room(chatId) {
    if (!this.transport?.getChat) {
      return {
        title: null,
        displayName: chatId,
        type: null,
        label: chatId,
        memberIds: [],
        fingerprint: fingerprint({ chatId, title: null, displayName: chatId, type: null, members: [] }),
      };
    }
    let room;
    try {
      room = await this.transport.getChat(chatId);
    } catch {
      fail('RECIPIENT_LOOKUP_FAILED');
    }
    if (!room || validChatId(String(room.chat_id)) !== chatId) fail('INVALID_RECIPIENT');
    const title = room.title ?? null;
    const displayName = room.display_name ?? null;
    const label =
      (typeof title === 'string' && title.trim()) ||
      (typeof displayName === 'string' && displayName.trim()) ||
      chatId;
    const memberIds = [];
    return {
      title,
      displayName,
      type: room.type ?? null,
      label,
      memberIds,
      fingerprint: fingerprint({ chatId, title, displayName, type: room.type ?? null, members: memberIds }),
    };
  }

  async preview(chatId, text) {
    chatId = validChatId(chatId);
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 4000) {
      fail('INVALID_TEXT');
    }

    const identity = this.transport ? this._identity() : 'offline';
    const room = await this._room(chatId);
    const createdAt = this._time();
    const previewId = randomUUID();
    const record = {
      version: 1,
      previewId,
      identity,
      chatId,
      text,
      textFingerprint: fingerprint(text),
      ...room,
      createdAt,
      expiresAt: createdAt + TTL_MS,
    };

    await this._ensureDir();
    const file = this._file(previewId, 'preview');
    let handle;
    try {
      handle = await fs.open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDir(this.stateDir);
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      fail('STATE_UNAVAILABLE');
    }
    return record;
  }

  _validatePreview(p, previewId) {
    if (!p || p.version !== 1) fail('INVALID_PREVIEW');
    if (p.previewId !== previewId) fail('INVALID_PREVIEW');
    if (typeof p.text !== 'string' || !p.text.trim()) fail('INVALID_PREVIEW');
    if (p.textFingerprint !== fingerprint(p.text)) fail('INVALID_PREVIEW');
    validChatId(p.chatId);
    if (!Number.isSafeInteger(p.createdAt) || !Number.isSafeInteger(p.expiresAt)) fail('INVALID_PREVIEW');
    if (p.expiresAt - p.createdAt !== TTL_MS) fail('INVALID_PREVIEW');
  }

  async send(previewId) {
    const reservationPath = this._file(previewId, 'reservation');
    try {
      await fs.stat(reservationPath);
      fail('ALREADY_ATTEMPTED');
    } catch (e) {
      if (e.code === 'ALREADY_ATTEMPTED') throw e;
      if (e.code !== 'ENOENT') fail('STATE_UNAVAILABLE');
    }

    const preview = await this._read(this._file(previewId, 'preview'), 'PREVIEW_NOT_FOUND');
    this._validatePreview(preview, previewId);

    const time = this._time();
    if (time >= preview.expiresAt || time < preview.createdAt) fail('PREVIEW_EXPIRED');
    if (this.transport && this._identity() !== preview.identity) fail('ACCOUNT_CHANGED');

    const initial = {
      previewId,
      chatId: preview.chatId,
      status: 'unknown',
      code: 'ATTEMPT_RESERVED',
      attemptedAt: this._time(),
    };

    let handle;
    try {
      handle = await fs.open(reservationPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(initial));
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDir(this.stateDir);
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      fail(e.code === 'EEXIST' ? 'ALREADY_ATTEMPTED' : 'STATE_UNAVAILABLE');
    }

    const save = async (status, code, extra = {}) => {
      const result = { ...initial, status, code, ...extra, updatedAt: this._time() };
      await atomicWrite(this._file(previewId, 'receipt'), result);
      return result;
    };

    if (!this.transport?.sendTextOnce) {
      return save('rejected', 'NO_TRANSPORT');
    }

    let response;
    try {
      response = await this.transport.sendTextOnce(preview.chatId, preview.text);
    } catch {
      return save('unknown', 'NETWORK_FAILURE');
    }

    try {
      const packetStatus = response?.statusCode;
      const bodyStatus = response?.body?.status;
      if (!Number.isSafeInteger(packetStatus)) return await save('unknown', 'INVALID_RESPONSE');
      if (packetStatus === -1) return await save('unknown', 'NETWORK_FAILURE');
      if (packetStatus !== 0 || (bodyStatus !== undefined && bodyStatus !== 0)) {
        return await save('rejected', 'PROVIDER_REJECTED');
      }
      const logId = response?.body?.logId != null ? String(response.body.logId) : null;
      return await save('accepted_unverified', 'HISTORY_NOT_VERIFIED', logId ? { logId } : {});
    } catch {
      return save('unknown', 'INVALID_RESPONSE');
    }
  }

  async receipt(previewId) {
    try {
      return await this._read(this._file(previewId, 'receipt'), 'RECEIPT_NOT_FOUND');
    } catch (e) {
      if (e.code !== 'RECEIPT_NOT_FOUND') throw e;
      return this._read(this._file(previewId, 'reservation'), 'RECEIPT_NOT_FOUND');
    }
  }

  async getPreview(previewId) {
    const preview = await this._read(this._file(previewId, 'preview'), 'PREVIEW_NOT_FOUND');
    this._validatePreview(preview, previewId);
    return preview;
  }
}
