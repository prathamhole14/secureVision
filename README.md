# AntiCheat Quiz Platform

A full-stack, multi-component secure examination platform featuring:
- **Backend** — Node.js + Express + Socket.IO + Prisma + PostgreSQL
- **Dashboard** — React (Vite) professor dashboard with live monitoring
- **Electron Client** — Hardened student exam client with kiosk mode
- **Rust Daemon** — Native OS-level security scanner over Unix IPC

---

## Project Structure

```
vision/
├── backend/            # Node.js + Express API server
│   ├── prisma/         # Database schema & migrations
│   └── src/
│       ├── routes/     # REST API routes (auth, exams, telemetry…)
│       ├── socket/     # Socket.IO real-time server
│       ├── services/   # Detection engine
│       └── middleware/ # Auth & logging
│
├── dashboard/          # Professor Dashboard (React + Vite)
│   └── src/
│       ├── pages/      # HomePage, ExamsPage, MonitorPage, ReportPage
│       └── contexts/   # AuthContext
│
├── student-client/     # Electron student app
│   └── src/
│       ├── main.ts     # Electron main process (kiosk, IPC bridge)
│       ├── preload.ts  # Secure contextBridge API
│       └── ui/         # HTML/CSS/JS renderer
│
├── security-daemon/    # Rust security daemon
│   └── src/main.rs    # Async Unix socket IPC + OS-level scanners
│
└── docker-compose.yml  # PostgreSQL for development
```

---

## Quick Start

### Requirements
- Node.js 20+
- Rust + Cargo (stable)
- Docker & docker-compose
- npm

---

### 1. Start the Database

```bash
docker-compose up -d
```

---

### 2. Start the Backend

```bash
cd backend

# Copy & configure environment
cp .env.example .env
# Edit .env with your GOOGLE_CLIENT_ID

# Install dependencies
npm install

# Generate Prisma client & run migrations
npm run db:generate
npm run db:migrate

# (Optional) Seed with sample data
npm run db:seed

# Start development server
npm run dev
```

Backend runs at: **http://localhost:3001**

---

### 3. Start the Professor Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs at: **http://localhost:5173**

---

### 4. Start the Electron Student Client

```bash
cd student-client
npm install
npm run build
npm run start
```

---

### 5. Build and Start the Rust Security Daemon

```bash
cd security-daemon

# Debug build (emits mock events every ~5 seconds for testing)
cargo run

# Or release build (production)
cargo build --release && ./target/release/anticheat-daemon
```

Daemon listens on: `/tmp/anticheat_daemon.sock`

---

## Component Communication

```
Rust Daemon <--(Unix socket JSON IPC)--> Electron Main Process
Electron Main <--(contextBridge/preload)--> Renderer (student UI)
Renderer <-----(REST / WebSocket WSS)-----> Node Backend
Dashboard <----(React + Socket.IO)--------> Node Backend
```

---

## Security Architecture

| Feature | Implementation |
|---|---|
| Context Isolation | `contextIsolation: true`, `nodeIntegration: false` |
| Kiosk Mode | `kiosk: true` in production build |
| Soft Sensors | `blur`, `visibilitychange`, `copy/paste/contextmenu` blocked |
| Daemon IPC | Sandboxed Unix socket — renderer cannot access directly |
| Screen Capture (Windows) | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` |
| Screen Capture (macOS) | `NSWindowSharingNone` on exam window |
| Process Scanning | Rust reads `/proc` on Linux, WMI on Windows |
| Remote Session Detection | `SSH_CONNECTION` env check, `SM_REMOTESESSION` on Windows |
| Policy Enforcement | Configurable per-exam: warn / pause / submit / lock |

---

## Anti-Cheat Detection Rules

| Rule | Severity | Trigger |
|---|---|---|
| `SCREEN_CAPTURE_ATTEMPT` | HIGH | DXGI duplication / pipewire session |
| `REMOTE_SESSION_DETECTED` | HIGH | RDP / SSH active |
| `DAEMON_TAMPER` | HIGH | Daemon binary checksum mismatch |
| `BLACKLISTED_PROCESS` | MEDIUM | AnyDesk, TeamViewer, OBS, Discord… |
| `MULTI_MONITOR` | MEDIUM | More than 1 display detected |
| `FOCUS_LOSS` | LOW | Window blur / alt-tab |
| `CLIPBOARD_ACCESS` | LOW | Copy/paste attempt |

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/google` | Google OAuth login → JWT |
| GET | `/api/exams` | List exams |
| POST | `/api/exams` | Create exam (professor) |
| POST | `/api/exams/:id/start` | Start exam session |
| POST | `/api/telemetry/batch` | Upload telemetry batch |
| GET | `/api/reports/:sessionId` | Session report |
| WS | `/ws` (Socket.IO `/exam`) | Real-time telemetry & commands |

---

## Next Steps

1. **Google OAuth**: Replace demo tokens with real Google Sign-In SDK integration
2. **S3 Evidence Upload**: Implement real snapshot/video upload to AWS S3
3. **Platform DRM**: Wire `SetWindowDisplayAffinity` / `NSWindowSharingNone` in Electron main
4. **Code Signing**: Sign binaries for Windows Authenticode and macOS notarization
5. **CI/CD**: Add Jest tests, GitHub Actions workflow
6. **ML Detection**: Add ML-based behavioral anomaly detection layer to the detection engine
