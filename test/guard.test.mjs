import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SendGuard } from '../src/guard.mjs';

function mockTransport({ sendImpl } = {}) {
  return {
    identity: '10001',
    async getChat(chatId) {
      return { chat_id: chatId, title: 'Test Room', display_name: 'Test Room', type: 'MultiChat' };
    },
    async sendTextOnce(chatId, text) {
      if (sendImpl) return sendImpl(chatId, text);
      return { statusCode: 0, body: { status: 0, logId: '9001' } };
    },
  };
}

describe('SendGuard preview lifecycle', () => {
  let dir;
  let now;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kakao-agent-guard-'));
    now = 1_700_000_000_000;
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates preview exclusively and returns metadata', async () => {
    const guard = new SendGuard({
      stateDir: dir,
      transport: mockTransport(),
      now: () => now,
    });
    const preview = await guard.preview('123456789', 'hello agent');
    assert.equal(preview.chatId, '123456789');
    assert.equal(preview.text, 'hello agent');
    assert.equal(preview.identity, '10001');
    assert.equal(preview.expiresAt, now + 600_000);
    assert.match(preview.previewId, /^[0-9a-f-]{36}$/i);
    const onDisk = JSON.parse(await readFile(join(dir, `${preview.previewId}.preview.json`), 'utf8'));
    assert.equal(onDisk.text, 'hello agent');
  });

  it('rejects invalid chat id and empty text', async () => {
    const guard = new SendGuard({ stateDir: dir, transport: mockTransport(), now: () => now });
    await assert.rejects(() => guard.preview('0', 'x'), { code: 'INVALID_ID' });
    await assert.rejects(() => guard.preview('123', '   '), { code: 'INVALID_TEXT' });
  });

  it('sends once via reservation then blocks retry', async () => {
    let sends = 0;
    const guard = new SendGuard({
      stateDir: dir,
      transport: mockTransport({
        sendImpl: async () => {
          sends += 1;
          return { statusCode: 0, body: { status: 0, logId: '42' } };
        },
      }),
      now: () => now,
    });
    const preview = await guard.preview('555', 'one shot');
    const receipt = await guard.send(preview.previewId);
    assert.equal(receipt.status, 'accepted_unverified');
    assert.equal(receipt.logId, '42');
    assert.equal(sends, 1);
    await assert.rejects(() => guard.send(preview.previewId), { code: 'ALREADY_ATTEMPTED' });
    assert.equal(sends, 1);
    const loaded = await guard.receipt(preview.previewId);
    assert.equal(loaded.code, 'HISTORY_NOT_VERIFIED');
  });

  it('records network failure without retry', async () => {
    const guard = new SendGuard({
      stateDir: dir,
      transport: mockTransport({
        sendImpl: async () => {
          throw new Error('boom');
        },
      }),
      now: () => now,
    });
    const preview = await guard.preview('777', 'fail path');
    const receipt = await guard.send(preview.previewId);
    assert.equal(receipt.status, 'unknown');
    assert.equal(receipt.code, 'NETWORK_FAILURE');
    await assert.rejects(() => guard.send(preview.previewId), { code: 'ALREADY_ATTEMPTED' });
  });

  it('expires old previews', async () => {
    let clock = now;
    const guard = new SendGuard({
      stateDir: dir,
      transport: mockTransport(),
      now: () => clock,
    });
    const preview = await guard.preview('888', 'old');
    clock = now + 600_001;
    await assert.rejects(() => guard.send(preview.previewId), { code: 'PREVIEW_EXPIRED' });
  });
});
