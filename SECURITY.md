# Security

Experimental, unofficial KakaoTalk access for agent workflows. **Do not use your primary Kakao account for initial testing.** Unofficial LOCO access may violate provider terms and can lead to account or device-slot restrictions.

## Trust boundary

The local OS user, Node runtime, optional `agent-messenger` peer, and config/state directories are trusted. A process with the same privileges can read the file vault, edit preview/reservation files, or call the provider directly. This CLI is not a sandbox against a malicious local agent.

## Credential vault (file-based)

Credentials are stored as JSON at:

- Linux/macOS: `$XDG_CONFIG_HOME/kakao-agent-cli/credentials.json` (fallback `~/.config/...`)
- Windows: `%APPDATA%\\kakao-agent-cli\\credentials.json`

Intended modes: directory `0700`, file `0600`. There is **no macOS Keychain** and no OS secret store. Files are not encrypted at rest. Do not place the config/state directories inside a git repo, cloud-sync folder, or shared volume.

Passwords are accepted only from a local TTY (hidden) or `--password-file`. They are never written to the vault, argv of child processes, or JSON stdout. OAuth tokens in the vault must not be printed by the CLI.

Device registration codes may appear on **stderr** during `auth login`. Do not paste them into public issues or agent transcripts.

## Sending

`preview` writes a durable JSON snapshot under the state previews directory (exclusive create). `send --confirm` creates an exclusive reservation file, then performs **one** raw session write. It does not call high-level retrying send APIs. Network failures and ambiguous results never retry. Do not delete reservations to “try again”; inspect `receipt` instead.

A successful packet is not proof the recipient read the message. Approval is bound to a preview snapshot; membership can still change between the last check and the write. Use a known test conversation.

## Provider pin

This package intentionally peers `agent-messenger@2.37.1` and imports `agent-messenger/kakaotalk`. A different version fails closed (`PROVIDER_VERSION_MISMATCH` / `PROVIDER_NOT_INSTALLED`). Unit tests do not perform live Kakao login.

## Reporting

Report vulnerabilities without tokens, passwords, messages, or real chat IDs. Prefer a private GitHub security advisory when available; otherwise open a minimal issue requesting a private contact channel.
