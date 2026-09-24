import { homedir } from 'node:os';
import { join } from 'node:path';

function isWindows() {
  return process.platform === 'win32';
}

/** Config dir for credentials (XDG / APPDATA). */
export function configDir(env = process.env, home = homedir()) {
  if (isWindows()) {
    const base = env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(base, 'kakao-agent-cli');
  }
  const base = env.XDG_CONFIG_HOME || join(home, '.config');
  return join(base, 'kakao-agent-cli');
}

/** State dir for previews (XDG_STATE / LOCALAPPDATA). */
export function stateDir(env = process.env, home = homedir()) {
  if (isWindows()) {
    const base = env.LOCALAPPDATA || env.APPDATA || join(home, 'AppData', 'Local');
    return join(base, 'kakao-agent-cli');
  }
  const base = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return join(base, 'kakao-agent-cli');
}

export function credentialsPath(env = process.env, home = homedir()) {
  return join(configDir(env, home), 'credentials.json');
}

export function previewsDir(env = process.env, home = homedir()) {
  return join(stateDir(env, home), 'previews');
}

export function providerCacheDir(env = process.env, home = homedir()) {
  return join(stateDir(env, home), 'provider-cache');
}
