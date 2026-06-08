# SecureVision: AntiCheat Quiz Platform

A full-stack, multi-component secure examination platform featuring:
- **Backend** — Node.js + Express + Socket.IO + Prisma + PostgreSQL
- **Dashboard** — React (Vite) web dashboard containing:
  - **Professor Dashboard**: Real-time telemetry monitoring, exam configuration, classroom setup, and proctor reports.
  - **Student Portal**: Classroom enrollment, assigned exams overview, grade history, and client access-code generation.
- **Electron Client** — Hardened student exam application running in kiosk mode, communicating with the backend and local Rust daemon.
- **Rust Daemon** — Native OS-level security daemon scanning for unauthorized processes, screen capture tools, display count, and remote connections.

---

## Project Structure

```
vision/
├── backend/            # Node.js + Express API server
│   ├── prisma/         # Database schema, migrations, and seeding
│   └── src/
│       ├── routes/     # REST API routes (auth, exams, sessions, classrooms, reports, evidence, telemetry)
│       ├── socket/     # Socket.IO real-time event distribution server
│       ├── services/   # Detection and telemetry analysis engine
│       └── middleware/ # Auth validation & request logging
│
├── dashboard/          # React + Vite Dashboard (Professor & Student Portal)
│   └── src/
│       ├── pages/      # Pages: HomePage, ClassesPage, StudentPortal, ExamsPage, MonitorPage, ReportPage, QuestionsPage, LoginPage
│       └── contexts/   # State Management (AuthContext)
│
├── student-client/     # Electron student desktop client
│   └── src/
│       ├── main.ts     # Electron main process (kiosk mode, process validation, IPC bridge)
│       ├── preload.ts  # Secure contextBridge API definition
│       └── ui/         # HTML/CSS/JS frontend exam interface
│
├── security-daemon/    # Rust security daemon
│   └── src/main.rs     # Named Pipe/Unix socket IPC, WMI/proc scanner, environment validator
│
└── docker-compose.yml  # PostgreSQL for local database development
```

---

## Quick Start

### Requirements
- Node.js 20+
- Rust + Cargo (stable)
- **Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes `docker-compose`)
- **Linux/macOS**: Docker & docker-compose
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
# Bash / Git Bash / WSL:
cp .env.example .env
# PowerShell:
# Copy-Item .env.example .env
# Edit .env with your JWT_SECRET and GOOGLE_CLIENT_ID (if using Google Auth)

# Install dependencies
npm install

# Generate Prisma client & run migrations
npm run db:generate
# To initialize database tables
npm run db:migrate

# Start development server
npm run dev
```

Backend runs at: **http://localhost:3001**

---

### 3. Start the Web Dashboard & Student Portal

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

# Or release build — Linux/macOS:
cargo build --release && ./target/release/anticheat-daemon

# Or release build — Windows (PowerShell):
# cargo build --release; .\target\release\anticheat-daemon.exe
```

Daemon IPC:
- **Windows**: Named Pipe `\\.\pipe\anticheat_daemon`
- **Linux/macOS**: Unix socket `/tmp/anticheat_daemon.sock`

> **Windows Note**: Copy the built `anticheat-daemon.exe` to `student-client/daemon/anticheat-daemon.exe` before running the Electron client in production packaging.

---

### 6. Clean Restart Script (PowerShell)

If you need to forcefully stop all background services (like dangling Electron instances) and do a clean restart of the backend, dashboard, and client concurrently, run this PowerShell script from the root directory:

```powershell
Get-Process node, electron, anticheat-daemon -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process powershell -ArgumentList "-NoExit -Command cd backend; npm run dev"
Start-Process powershell -ArgumentList "-NoExit -Command cd dashboard; npm run dev"
Start-Process powershell -ArgumentList "-NoExit -Command cd student-client; npm run build; npm run start"
```

---

## Component Communication

```
Rust Daemon <--(Named Pipe / Unix socket JSON IPC)--> Electron Main Process
Electron Main <--(contextBridge/preload)-------------> Renderer (Student Kiosk UI)
Renderer <---------(REST / WebSocket WSS)------------> Node Backend
Dashboard <---------(React + Socket.IO)--------------> Node Backend
```

---

## Key Features & Final Version Updates

### 1. Classroom & Course Management
- **Professors** can create classrooms, generate unique enrollment codes (e.g. `CL-XXXXXX`), and assign specific exams to these classrooms.
- **Students** can enroll in classrooms using the codes to access assigned quizzes and exams.
- Classroom pages display aggregate submissions and a **leaderboard/ranking** for graded sessions.

### 2. Unified Web Portal
- The interface features a **Student Portal** page where students view active courses, register for pending exams, generate client entry codes, and inspect detailed grades of past submissions.
- Support for traditional **Email/Password authentication** (secured via `bcrypt` hashing) as well as **Google OAuth**.

### 3. Secure Access-Code Flow
- Instead of downloading hardcoded configurations, students obtain a unique entry code (`SV-XXXXXX`) from the Student Portal.
- The student enters this code into the Electron Client. The client validates the code with the backend, receives the exam configuration with **all answer keys strictly stripped**, and initiates kiosk mode.

### 4. Real-time Proctoring & Manual Overrides
- Live telemetry streams low-level hardware metrics and daemon scanner status to the professor's Monitor Page using Socket.io.
- The backend automatically auto-grades submissions upon completion.
- Professors can review flag occurrences on the Report Page and apply **manual grade overrides/penalties** (such as mark deductions or complete disqualification) to student submissions.

---

## Security Architecture

| Feature | Implementation |
|---|---|
| Context Isolation | `contextIsolation: true`, `nodeIntegration: false` in Electron client |
| Kiosk Mode | Hardened full-screen kiosk lock (`kiosk: true`, `alwaysOnTop: true`, disables shortcut keys) |
| Soft Sensors | Focus tracking (`blur`, `visibilitychange`), copy/paste and context menus blocked |
| Daemon IPC | Local OS sockets/pipes; renderer layer has no direct binary access |
| Screen Capture (Windows) | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` blocks screenshots/recording tools |
| Screen Capture (macOS) | `NSWindowSharingNone` on exam window prevents screen share |
| Process Scanning | Rust daemon inspects active process logs (WMI on Windows, `/proc` on Linux) |
| Remote Session Detection | Environmental checks (`SSH_CONNECTION`, `SM_REMOTESESSION`) block virtualized environments |
| Enforcement Rules | Configurable actions per-severity level: log, warn, pause, submit, or lock screen |

---

## Anti-Cheat Detection Rules

| Rule | Severity | Trigger |
|---|---|---|
| `SCREEN_CAPTURE_ATTEMPT` | HIGH | Active DXGI desktop duplication / pipewire session |
| `REMOTE_SESSION_DETECTED` | HIGH | RDP, SSH, VNC, or TeamViewer connection active |
| `DAEMON_TAMPER` | HIGH | Daemon connection lost or binary checksum mismatch |
| `BLACKLISTED_PROCESS` | MEDIUM | Unauthorized running app (e.g. OBS, Discord, AnyDesk) |
| `MULTI_MONITOR` | MEDIUM | Extra display monitors connected to device |
| `FOCUS_LOSS` | LOW | Kiosk window loses active OS focus |
| `CLIPBOARD_ACCESS` | LOW | Copy, paste, or cut events triggered |

---

## API Overview

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user (email, password, name, role) |
| POST | `/api/auth/login` | Email/password credential login → JWT |
| POST | `/api/auth/google` | Google OAuth login → JWT |

### Classrooms
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/classrooms` | List classrooms (created for professors, enrolled for students) |
| POST | `/api/classrooms` | Create a new classroom (professor only) |
| POST | `/api/classrooms/join` | Join a classroom via code (student only) |
| GET | `/api/classrooms/:id` | Get classroom details, roster, exams, and E2E submissions |

### Exams
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/exams` | List exams (owned for professors, active assigned for students) |
| POST | `/api/exams` | Create a new exam and optionally link to classrooms (professor only) |
| GET | `/api/exams/:id` | Get exam details (strips answers for students) |
| PATCH | `/api/exams/:id` | Update exam state or details (professor only) |
| DELETE | `/api/exams/:id` | Delete an exam (professor only) |
| PUT | `/api/exams/:id/questions` | Update the list of questions for an exam (professor only) |
| POST | `/api/exams/:id/start` | Student starts an exam directly, returning a session token |

### Sessions & Proctoring
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sessions/my-sessions` | Retrieve past exam sessions and grades for the current student |
| POST | `/api/sessions/generate-code` | Generate entry code (`SV-XXXXXX`) for launching the student client |
| POST | `/api/sessions/validate-code` | Electron client validates code, returning exam configuration and session token |
| GET | `/api/sessions/:id` | Fetch details and event counts for a specific session |
| PATCH | `/api/sessions/:id/status` | Update session status (ACTIVE, COMPLETED, etc.) and auto-grade responses |
| POST | `/api/sessions/:id/penalize` | Manually deduct marks or disqualify a student submission (professor only) |
| POST | `/api/telemetry/batch` | Stream telemetry batch logs from student client to backend |
| POST | `/api/evidence` | Upload base64/files snapshots and logs (S3 stub) |
| GET | `/api/reports/:sessionId` | Detailed session proctor report with events and flags |
| GET | `/api/reports/exam/:examId` | Summary list of all student sessions for a given exam |
| WS | `/ws` (Socket.IO) | Bidirectional channel for real-time telemetry stream |
