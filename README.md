# kakao-agent-cli

**AI 에이전트용 크로스플랫폼 카카오톡 CLI** — 파일 기반 credential vault (macOS Keychain 없음).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **비공식 · 실험용 · 테스트 계정만 사용하세요.**  
> 이 도구는 카카오의 공식 API/봇 SDK가 아닙니다. LOCO 프로토콜 접근은 서비스 약관(ToS)에 위배될 수 있으며, 계정 제한·기기 슬롯 충돌·세션 강제 종료가 발생할 수 있습니다. **본계정으로 처음 실험하지 마세요.**

## 한줄 요약

`agent-messenger@2.37.1`의 `agent-messenger/kakaotalk`을 peer로 감싸, Linux / macOS / Windows에서 동일한 **파일 vault**로 로그인 상태를 보관하고, preview → confirm → one-shot send 흐름으로 메시지를 보냅니다.

## 왜 만들었나 (비교)

| | **kakao-agent-cli** (이 패키지) | **kakao-headless** | **agent-kakaotalk** (raw) |
|---|---|---|---|
| OS | Linux, macOS, Windows | macOS 중심 (Keychain) | 플랫폼별 provider CLI |
| 자격 증명 | `$XDG_CONFIG_HOME/.../credentials.json` (0600) / Windows `%APPDATA%` | macOS Keychain + envelope | agent-messenger 자체 저장 |
| 목적 | 에이전트용 얇은 래퍼 + 파일 vault | Aside 연동·이미지 전송·정교한 guard | 범용 메신저 CLI |
| 라이선스 | 이 래퍼만 MIT | MIT (래퍼) | provider 별도 / 불명확 |

`agent-kakaotalk`은 `agent-messenger`가 제공하는 실행 파일입니다. 이 패키지는 그 CLI를 대체하기보다, **파일 vault + preview/send 가드**를 에이전트에 맞게 얇게 감쌉니다.

## 요구 사항

- Node.js **>= 22.13.0**
- peer: **`agent-messenger@2.37.1`** (별도 설치)

## 설치

```sh
npm install -g kakao-agent-cli agent-messenger@2.37.1
# 또는 이 저장소에서:
cd kakao-agent-cli
npm install
npm install --no-save agent-messenger@2.37.1   # peer 해석용
```

로컬 확인:

```sh
kakao-agent doctor
# 또는
node src/cli.mjs doctor
```

`doctor`는 platform / node / vault path / `agent-messenger` resolve 여부를 JSON으로 출력합니다.

## 빠른 시작 (테스트 계정)

```sh
# 1) 로그인 — 비밀번호는 TTY 또는 파일로만
kakao-agent auth login --email YOU@example.com --ack-risk
# 또는
printf '%s' 'YOUR_PASSWORD' > /tmp/kakao-pass && chmod 600 /tmp/kakao-pass
kakao-agent auth login --email YOU@example.com --password-file /tmp/kakao-pass --ack-risk
rm -f /tmp/kakao-pass

# 기기 등록 코드가 필요하면 stderr에 표시됩니다. 휴대폰에서 확인하세요.
# 비밀번호·토큰을 에이전트 채팅에 붙여 넣지 마세요.

kakao-agent auth status

# 2) 대화 목록 / 히스토리
kakao-agent chats --search '테스트' --ack-risk
kakao-agent history 'CHAT_ID' --count 30 --ack-risk

# 3) 미리보기 → 확인 후 1회 전송 (재시도 없음)
kakao-agent preview 'CHAT_ID' --text '안녕하세요' --ack-risk
kakao-agent send 'PREVIEW_ID' --confirm --ack-risk
kakao-agent receipt 'PREVIEW_ID'

kakao-agent auth logout
```

모든 라이브 작업(`login`, `chats`, `history`, `preview`, `send`)은 **`--ack-risk`** 가 필요합니다.

## Credential vault (파일)

| OS | 경로 |
|---|---|
| Linux / macOS | `$XDG_CONFIG_HOME/kakao-agent-cli/credentials.json` (없으면 `~/.config/...`) |
| Windows | `%APPDATA%\kakao-agent-cli\credentials.json` |

- 디렉터리 모드 `0700`, 파일 모드 `0600` (가능한 OS에서)
- **Keychain / Credential Manager 사용 안 함** — 백업·동기화 폴더에 넣지 마세요
- Preview / receipt: `$XDG_STATE_HOME/kakao-agent-cli/previews/` (없으면 `~/.local/state/...`), Windows는 `%LOCALAPPDATA%`

## 명령 요약

| 명령 | 설명 |
|---|---|
| `doctor` | 환경·vault·provider resolve 점검 (오프라인) |
| `auth login` | email + 비밀번호 → FileVault 저장 |
| `auth status` / `auth logout` | 상태 / 로컬 자격 증명 삭제 |
| `chats` / `history` | 대화 목록 / 메시지 |
| `preview` | 전송하지 않고 preview JSON 생성 |
| `send --confirm` | preview 1회 전송, 예약 파일로 재시도 차단 |
| `receipt` | 전송 결과 |

출력은 help를 제외하고 **JSON stdout**입니다. 비밀번호·토큰은 출력하지 않습니다.

## 보안 · 약관

자세한 내용은 [SECURITY.md](SECURITY.md), 제3자 경계는 [THIRD_PARTY.md](THIRD_PARTY.md)를 보세요.

- 비공식 접근 · ToS 위반 가능 · 계정 제재 위험
- 테스트 전용 계정 사용
- 로컬 파일 vault는 암호화된 OS Keychain이 아님
- `send`는 고수준 재시도 API를 쓰지 않고 세션에 1회만 WRITE

## 개발

```sh
npm test          # node:test (vault / guard) — 실제 카카오 호출 없음
npm run check
```

## License

MIT — 이 저장소의 래퍼 코드에만 적용됩니다. `agent-messenger` 및 그 의존성은 별도 조건입니다.
