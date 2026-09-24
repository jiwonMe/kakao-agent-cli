import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVault } from '../src/vault.mjs';

describe('FileVault', () => {
  let dir;
  let vault;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kakao-agent-vault-'));
    vault = new FileVault({ path: join(dir, 'credentials.json') });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when empty', async () => {
    assert.equal(await vault.getAccount(), null);
  });

  it('sets and gets account', async () => {
    const account = {
      oauth_token: 'tok_test_not_real',
      refresh_token: 'ref_test',
      user_id: '12345',
      device_uuid: 'abcdEFGH12345678',
      device_type: 'tablet',
    };
    await vault.setAccount(account);
    assert.deepEqual(await vault.getAccount(), account);
  });

  it('writes mode 0o600 on unix', async () => {
    if (process.platform === 'win32') return;
    const st = await stat(join(dir, 'credentials.json'));
    assert.equal(st.mode & 0o777, 0o600);
  });

  it('copies account on set/get', async () => {
    const account = {
      oauth_token: 'tok2',
      refresh_token: '',
      user_id: '99',
      device_uuid: 'zzzzzzzz',
      device_type: 'pc',
    };
    await vault.setAccount(account);
    account.oauth_token = 'mutated';
    assert.equal((await vault.getAccount()).oauth_token, 'tok2');
  });

  it('deletes account and removes empty store', async () => {
    assert.equal(await vault.deleteAccount(), true);
    assert.equal(await vault.getAccount(), null);
    await assert.rejects(() => readFile(join(dir, 'credentials.json')), { code: 'ENOENT' });
  });

  it('get/set/delete aliases', async () => {
    await vault.set('account', {
      oauth_token: 'a',
      refresh_token: 'b',
      user_id: '1',
      device_uuid: 'abcdefgh',
      device_type: 'tablet',
    });
    assert.equal((await vault.get('account')).user_id, '1');
    await vault.delete('account');
    assert.equal(await vault.get('account'), null);
  });
});
