# Messistant

<p align="center">
  <img src="public/messistant.jpg" alt="Lionel Messi holding a WhatsApp logo" width="600">
</p>

<p align="center">
  <strong>Messages are messy. Sometimes they just need a Messi assist.</strong>
</p>

Messistant is a self-hosted WhatsApp assistant built around reusable
assists. It observes a linked WhatsApp Web session, keeps a privacy-minded
activity ledger, and dispatches commands or automatic events to independently
configured assists.

This is an MVP, but not a proof of concept: configuration is persistent,
credentials are protected, access is explicit, message events are deduplicated,
and the admin console handles the complete WhatsApp QR flow.

## What it does

- Explains Argentine Spanish with `!!!`, using a quoted or recent message.
- Conjugates verbs with `!conj <verb> [tense/person]`.
- Automatically transcribes allowlisted incoming voice notes with OpenAI, or
  transcribes any quoted voice note when the owner replies with `!stt`.
- Reports private activity with `!stats today` or `!stats week` in your
  self-chat.
- Collects message metadata continuously for durable statistics.
- Provides a password-protected admin console for WhatsApp, OpenAI, retention,
  assists, and access policies.

Messistant never hardcodes phone numbers or assist audiences. Each assist can
be disabled, restricted to the self-chat, restricted to the
owner, attached to reusable access groups, assigned one-off chat IDs, or made
available everywhere.

## How it is shaped

```text
WhatsApp Web
    │
    ▼
normalized message event
    │
    ├── deduplicated metadata ledger (SQLite)
    │
    ▼
assist dispatcher
    ├── per-chat execution queue
    ├── assist-specific access policy
    └── reusable access groups
         │
         ├── !!! explanation
         ├── !conj
         ├── voice-note transcription
         └── private messaging stats
```

Message bodies and downloaded media are not stored in the activity ledger.
Statistics retain identifiers, timestamps, direction, chat type, message type,
and voice-note duration. The retention window is configurable.

## Requirements

- Node.js 22 or newer
- A machine that can run continuously
- A WhatsApp account capable of linking a WhatsApp Web device
- An OpenAI API key for AI-backed assists

`whatsapp-web.js` drives WhatsApp Web through Chromium. It is not the official
WhatsApp Business API, so WhatsApp Web changes can occasionally require a
dependency update.

## First run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. Sign in with username `admin` and password `admin`.
2. Change the default password immediately.
3. Scan the QR code from WhatsApp → **Linked devices**.
4. Open **Settings** and save an OpenAI API key.
5. Create reusable audiences under **Access**.
6. Assign an access policy to every assist.

Automatic voice transcription starts with an empty allowlist, while self-chat
voice notes remain automatic. In any other conversation, the owner can reply to
a voice note with `!stt` for a one-off transcription. This does not add that
chat to the automatic allowlist.

## Production-style run

Build and start the compiled service:

```bash
npm run build
npm start
```

Run that command through the process supervisor native to the host—launchd,
systemd, Docker, or another restart-aware service manager. Keep the `data/`
directory on persistent storage and include it in protected backups.

The service handles `SIGINT` and `SIGTERM` gracefully, closing the admin server,
WhatsApp client, and SQLite database in order.

## Configuration

Environment variables are intended for bootstrap configuration:

| Variable | Default | Purpose |
|---|---:|---|
| `MESSISTANT_HOST` | `127.0.0.1` | Admin server bind address |
| `MESSISTANT_PORT` | `3000` | Admin server port |
| `MESSISTANT_DATA_DIR` | `./data` | SQLite, vault key, and WhatsApp session |
| `MESSISTANT_LOG_LEVEL` | `info` | Structured log level |
| `OPENAI_API_KEY` | — | Optional environment-provided OpenAI credential |
| `PUPPETEER_NO_SANDBOX` | `false` | Chromium fallback for restricted containers |

For a local environment file:

```bash
cp .env.example .env
node --env-file=.env dist/main.js
```

An API key entered through the admin console is encrypted with AES-256-GCM.
The encryption key is generated locally at `data/master.key` with restrictive
permissions. If `OPENAI_API_KEY` exists in the environment, it takes precedence
over the encrypted local value.

The default models are:

- Text: `gpt-5.6-luna`
- Transcription: `whisper-1`

Both model identifiers are editable in the admin console.

## Assist access policies

| Policy | Meaning |
|---|---|
| Disabled | The assist never runs |
| Self-chat only | Runs only in WhatsApp’s “message yourself” conversation |
| Owner, from any chat | Runs only on messages sent by the linked account |
| Allowlist only | Runs only in selected chats or reusable access groups |
| Owner or allowlist | Owner commands everywhere plus selected chats |
| Everyone | Runs in any observed eligible chat |

For voice transcription, this policy controls the automatic mode. The
owner-only `!stt` command remains available in any conversation while the
assist is enabled.

Self-chat-only checks the actual conversation, not merely whether a message was
sent by the owner. This prevents private commands such as statistics from
running accidentally inside somebody else’s conversation.

## Commands

### Explain a message

```text
!!!
!!! -2
!!! che boludo
```

Replying to a message with `!!!` explains the quoted message. Otherwise `!!!`
uses the immediately preceding message. A negative number selects an older
message, while free text tells Messistant which words to focus on.

### Conjugate a verb

```text
!conj tener
!conj tener present
!conj tener vos
```

### Transcribe a voice note

Voice notes received in allowlisted chats transcribe automatically. Your own
self-chat voice notes do too.

For a one-off transcription anywhere else, reply to the voice note with:

```text
!stt
```

Only the linked account can use `!stt`. The command does not change the
conversation’s automatic transcription access.

### Private messaging statistics

Send these commands inside your self-chat:

```text
!stats today
!stats week
```

Statistics start when Messistant starts observing messages. Brief disconnects
can create gaps if WhatsApp Web never replays the missed events.

## Security notes

- The admin server binds to localhost by default.
- The initial password is intentionally known and is flagged until changed.
- Passwords are hashed with scrypt.
- Sessions are random, server-side, expiring, HTTP-only, and same-site.
- Mutating forms require a session-bound CSRF token.
- Login attempts are rate-limited.
- QR values stay in memory.
- API keys, cookies, message bodies, transcripts, and QR values are redacted
  from structured logs.
- WhatsApp browser/session data is never served by the web application.

If binding beyond localhost, change the password first and place Messistant
behind HTTPS with an authenticated private network or trusted reverse proxy.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The project is TypeScript ESM and uses Fastify, SQLite, the official OpenAI Node
SDK, and `whatsapp-web.js`.
