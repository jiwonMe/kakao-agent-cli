#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { stdin as input, stdout as output, stderr } from 'node:process';
import { FileVault } from './vault.mjs';
import { SendGuard } from './guard.mjs';
import {
  Client,
  resolveProviderInfo,
  loginAndStore,
  authStatus,
  authLogout,
  fail,
  SUPPORTED_VERSION,
} from './client.mjs';
import { configDir, stateDir, credentialsPath, previewsDir } from './paths.mjs';

const HELP = `kakao-agent — Cross-platform KakaoTalk CLI for AI agents (file vault)

Usage:
  kakao-agent doctor
  kakao-agent auth login --email EMAIL --ack-risk [--password-file FILE] [--device-type tablet|pc] [--force]
  kakao-agent auth status
  kakao-agent auth logout
  kakao-agent chats [--search NAME] --ack-risk
  kakao-agent history CHAT_ID [--count N] --ack-risk
  kakao-agent preview CHAT_ID --text "..."|--text-file FILE --ack-risk
  kakao-agent send PREVIEW_ID --confirm --ack-risk
  kakao-agent receipt PREVIEW_ID

Notes:
  - Live ops require --ack-risk (unofficial / ToS risk acknowledgement).
  - Credentials are stored in a file vault (mode 0600), not macOS Keychain.
  - Never paste passwords or tokens into agent chat. Prefer --password-file or a local TTY.
  - peerDependency: agent-messenger@${SUPPORTED_VERSION}
`;

function out(value) {
  output.write(`${JSON.stringify(value)}\n`);
}

function die(code, message) {
  stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exitCode = 1;
}

async function readPasswordHidden() {
  if (!input.isTTY) fail('PASSWORD_REQUIRED');
  stderr.write('Password (hidden): ');
  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();
  try {
    return await new Promise((resolve, reject) => {
      let buf = '';
      const onData = (chunk) => {
        const s = chunk.toString('utf8');
        for (const ch of s) {
          if (ch === '\n' || ch === '\r' || ch === '\u0004') {
            cleanup();
            stderr.write('\n');
            resolve(buf);
            return;
          }
          if (ch === '\u0003') {
            cleanup();
            reject(Object.assign(new Error('INTERRUPTED'), { code: 'INTERRUPTED' }));
            return;
          }
          if (ch === '\u007f' || ch === '\b') {
            buf = buf.slice(0, -1);
            continue;
          }
          buf += ch;
        }
      };
      const cleanup = () => {
        input.removeListener('data', onData);
        input.setRawMode?.(wasRaw);
      };
      input.on('data', onData);
    });
  } catch (e) {
    input.setRawMode?.(wasRaw);
    throw e;
  }
}

async function resolvePassword(flags) {
  if (flags['password-file']) {
    const raw = await readFile(flags['password-file'], 'utf8');
    const password = raw.replace(/\r?\n$/, '');
    if (!password) fail('INVALID_LOGIN_INPUT');
    return password;
  }
  return readPasswordHidden();
}

function requireAck(flags) {
  if (!flags['ack-risk']) fail('ACKNOWLEDGE_UNOFFICIAL_ACCOUNT_RISK');
}

async function withClient(fn) {
  const vault = new FileVault();
  const account = await vault.getAccount();
  if (!account) fail('NOT_AUTHENTICATED');
  const client = await Client.connect({ account });
  try {
    return await fn(client, vault);
  } finally {
    client.close();
  }
}

async function main() {
  const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      'ack-risk': { type: 'boolean' },
      confirm: { type: 'boolean' },
      email: { type: 'string' },
      'password-file': { type: 'string' },
      'device-type': { type: 'string' },
      force: { type: 'boolean' },
      search: { type: 'string' },
      count: { type: 'string' },
      text: { type: 'string' },
      'text-file': { type: 'string' },
    },
  });

  if (flags.help || positionals.length === 0) {
    output.write(HELP);
    return;
  }

  const [command, target] = positionals;

  try {
    if (command === 'doctor') {
      const provider = await resolveProviderInfo();
      out({
        ok: true,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        engines: '>=22.13.0',
        vault: {
          type: 'file',
          path: credentialsPath(),
          configDir: configDir(),
        },
        state: {
          dir: stateDir(),
          previews: previewsDir(),
        },
        provider: {
          name: 'agent-messenger',
          ...provider,
        },
      });
      return;
    }

    if (command === 'auth') {
      if (target === 'status') {
        out(await authStatus());
        return;
      }
      if (target === 'logout') {
        out(await authLogout());
        return;
      }
      if (target === 'login') {
        requireAck(flags);
        if (!flags.email) fail('INVALID_LOGIN_INPUT');
        const password = await resolvePassword(flags);
        const deviceType = flags['device-type'] || 'tablet';
        const result = await loginAndStore({
          email: flags.email,
          password,
          deviceType,
          force: Boolean(flags.force),
        });
        out(result);
        if (!result.authenticated) process.exitCode = 1;
        return;
      }
      fail('INVALID_COMMAND');
    }

    if (command === 'chats') {
      requireAck(flags);
      const chats = await withClient((c) => c.listChats(flags.search));
      out({ ok: true, chats });
      return;
    }

    if (command === 'history') {
      requireAck(flags);
      if (!target) fail('INVALID_COMMAND');
      const count = flags.count !== undefined ? Number(flags.count) : 30;
      const messages = await withClient((c) => c.getHistory(target, { count }));
      out({ ok: true, chat_id: target, messages });
      return;
    }

    if (command === 'preview') {
      requireAck(flags);
      if (!target) fail('INVALID_COMMAND');
      let text = flags.text;
      if (flags['text-file']) {
        text = await readFile(flags['text-file'], 'utf8');
      }
      if (typeof text !== 'string') fail('INVALID_TEXT');
      const result = await withClient(async (c) => {
        const guard = new SendGuard({ transport: c });
        return guard.preview(target, text);
      });
      out({
        ok: true,
        previewId: result.previewId,
        chatId: result.chatId,
        label: result.label,
        text: result.text,
        expiresAt: result.expiresAt,
      });
      return;
    }

    if (command === 'send') {
      requireAck(flags);
      if (!flags.confirm) fail('CONFIRM_REQUIRED');
      if (!target) fail('INVALID_COMMAND');
      const result = await withClient(async (c) => {
        const guard = new SendGuard({ transport: c });
        return guard.send(target);
      });
      out(result);
      return;
    }

    if (command === 'receipt') {
      if (!target) fail('INVALID_COMMAND');
      const guard = new SendGuard();
      out(await guard.receipt(target));
      return;
    }

    fail('INVALID_COMMAND');
  } catch (e) {
    die(e.code || 'ERROR', e.message || String(e));
  }
}

main();
