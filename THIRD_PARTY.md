# Third-party boundaries

This repository is an **original thin wrapper**. It does not bundle or fork `agent-messenger` protocol sources.

## This package (MIT)

`kakao-agent-cli` MIT license covers only the files in this repository (CLI, file vault, guard, docs).

## Peer: agent-messenger@2.37.1

- Repository: https://github.com/agent-messenger/agent-messenger
- Installed explicitly by the operator (`npm install agent-messenger@2.37.1`), never fetched dynamically by this CLI at runtime beyond normal Node resolution.
- Package metadata may omit a clear license field; the upstream README may mention MIT while protocol NOTICE files reference other research terms. **Do not treat this wrapper’s MIT license as a grant over agent-messenger or its transitive dependencies.** Review that tree independently.

## Direct dependency

- `bson@6.10.4` (Apache-2.0) — used for `Long` chat IDs on the one-shot send path.

## Related tools (not dependencies)

- **kakao-headless** — separate macOS/Keychain-oriented project; not copied into this tree.
- **agent-kakaotalk** — executable name shipped by `agent-messenger`; not this package.

Retain your own lockfile when installing the peer for reproducible reviews.
