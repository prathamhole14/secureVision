//! AntiCheat Security Daemon
//!
//! Cross-platform daemon that runs alongside the Electron exam client.
//! It performs OS-level checks and reports security events via IPC to the
//! Electron parent process.
//!
//! IPC transport:
//!   Windows — Named Pipe  : \\.\pipe\anticheat_daemon
//!   Linux/macOS — Unix socket: /tmp/anticheat_daemon.sock
//!
//! IPC Protocol: newline-delimited JSON messages.
//!
//! Commands received from Electron:
//!   {"command": "start_protection", "sessionKey": "..."}
//!   {"command": "stop_protection"}
//!   {"command": "get_status"}
//!
//! Events emitted to Electron:
//!   {"type": "screen_capture_attempt", "severity": "HIGH", "timestamp": "...", "payload": {...}}
//!   {"type": "process_detected", "severity": "MEDIUM", "timestamp": "...", "payload": {"process": "anydesk"}}
//!   etc.

use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::broadcast;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use rand::Rng;
use tracing::{info, warn, error};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct IpcCommand {
    command: String,
    #[serde(rename = "sessionKey")]
    session_key: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct TelemetryEvent {
    #[serde(rename = "type")]
    event_type: String,
    severity: String,
    timestamp: String,
    payload: serde_json::Value,
}

impl TelemetryEvent {
    fn new(event_type: &str, severity: &str, payload: serde_json::Value) -> Self {
        Self {
            event_type: event_type.to_string(),
            severity: severity.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            payload,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct StatusResponse {
    status: String,
    protecting: bool,
    platform: String,
    version: String,
}

// ── IPC Path / Name ────────────────────────────────────────────────────────

#[cfg(windows)]
const PIPE_NAME: &str = r"\\.\pipe\anticheat_daemon";

#[cfg(unix)]
const SOCKET_PATH: &str = "/tmp/anticheat_daemon.sock";

// ── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .init();

    let (event_tx, _) = broadcast::channel::<TelemetryEvent>(256);
    let protecting = Arc::new(AtomicBool::new(false));

    #[cfg(windows)]
    run_windows_server(event_tx, protecting).await;

    #[cfg(unix)]
    run_unix_server(event_tx, protecting).await;
}

// ── Windows Named Pipe Server ──────────────────────────────────────────────

#[cfg(windows)]
async fn run_windows_server(
    event_tx: broadcast::Sender<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    use tokio::net::windows::named_pipe::ServerOptions;

    info!("🔐 AntiCheat Daemon starting on Windows Named Pipe: {}", PIPE_NAME);

    let mut first = true;
    loop {
        // The very first instance must use first_pipe_instance(true) to register the name.
        // Subsequent instances (waiting for next client) use false.
        let server = match ServerOptions::new()
            .first_pipe_instance(first)
            .create(PIPE_NAME)
        {
            Ok(s) => { first = false; s }
            Err(e) => {
                error!("Failed to create named pipe server: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        // Wait for a client to connect
        if let Err(e) = server.connect().await {
            error!("Named pipe connect() error: {}", e);
            continue;
        }

        info!("Client connected via Named Pipe");
        let tx = event_tx.clone();
        let rx = event_tx.subscribe();
        let protecting_clone = Arc::clone(&protecting);
        tokio::spawn(handle_pipe_client(server, tx, rx, protecting_clone));
    }
}

#[cfg(windows)]
async fn handle_pipe_client(
    stream: tokio::net::windows::named_pipe::NamedPipeServer,
    event_tx: broadcast::Sender<TelemetryEvent>,
    mut event_rx: broadcast::Receiver<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    use tokio::io::split;
    let (read_half, write_half) = split(stream);
    handle_connection(read_half, write_half, event_tx, event_rx, protecting).await;
}

// ── Unix Domain Socket Server ──────────────────────────────────────────────

#[cfg(unix)]
async fn run_unix_server(
    event_tx: broadcast::Sender<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    use tokio::net::UnixListener;

    // Remove stale socket file
    let _ = std::fs::remove_file(SOCKET_PATH);

    let listener = UnixListener::bind(SOCKET_PATH)
        .expect("Failed to bind Unix socket");
    info!("🔐 AntiCheat Daemon listening on {}", SOCKET_PATH);

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let tx = event_tx.clone();
                let rx = event_tx.subscribe();
                let protecting_clone = Arc::clone(&protecting);
                tokio::spawn(handle_unix_client(stream, tx, rx, protecting_clone));
            }
            Err(e) => {
                error!("Accept error: {}", e);
            }
        }
    }
}

#[cfg(unix)]
async fn handle_unix_client(
    stream: tokio::net::UnixStream,
    event_tx: broadcast::Sender<TelemetryEvent>,
    event_rx: broadcast::Receiver<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    let (read_half, write_half) = stream.into_split();
    handle_connection(read_half, write_half, event_tx, event_rx, protecting).await;
}

// ── Shared Client Handler ──────────────────────────────────────────────────

async fn handle_connection<R, W>(
    read_half: R,
    mut write_half: W,
    event_tx: broadcast::Sender<TelemetryEvent>,
    mut event_rx: broadcast::Receiver<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    info!("Client connected");
    let mut reader = BufReader::new(read_half);

    // Spawn scanner tasks that run when protection is active
    let scanner_tx = event_tx.clone();
    let protecting_scanner = Arc::clone(&protecting);
    tokio::spawn(async move {
        scanner_loop(scanner_tx, protecting_scanner).await;
    });

    // Read commands from Electron
    let protecting_cmd = Arc::clone(&protecting);
    let mut line_buf = String::new();
    loop {
        line_buf.clear();
        tokio::select! {
            result = reader.read_line(&mut line_buf) => {
                match result {
                    Ok(0) => { info!("Client disconnected"); break; }
                    Ok(_) => {
                        let trimmed = line_buf.trim();
                        if trimmed.is_empty() { continue; }
                        match serde_json::from_str::<IpcCommand>(trimmed) {
                            Ok(cmd) => {
                                if let Some(response) = process_command(&cmd, &protecting_cmd, &event_tx).await {
                                    let msg = serde_json::to_string(&response).unwrap() + "\n";
                                    let _ = write_half.write_all(msg.as_bytes()).await;
                                }
                            }
                            Err(e) => warn!("Invalid command: {} — {:?}", trimmed, e),
                        }
                    }
                    Err(e) => { error!("Read error: {}", e); break; }
                }
            },
            // Forward daemon events to this Electron client
            event = event_rx.recv() => {
                match event {
                    Ok(ev) => {
                        let msg = serde_json::to_string(&ev).unwrap() + "\n";
                        if write_half.write_all(msg.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => {}
                }
            }
        }
    }
    protecting.store(false, Ordering::SeqCst);
    info!("Stopped protection due to client disconnect");
}

// ── Command Processing ─────────────────────────────────────────────────────

async fn process_command(
    cmd: &IpcCommand,
    protecting: &Arc<AtomicBool>,
    _tx: &broadcast::Sender<TelemetryEvent>,
) -> Option<serde_json::Value> {
    match cmd.command.as_str() {
        "start_protection" => {
            protecting.store(true, Ordering::SeqCst);
            info!("🛡️  Protection started (session={})", cmd.session_key.as_deref().unwrap_or("unknown"));
            apply_drm_policy();
            Some(serde_json::json!({ "ok": true, "command": "start_protection" }))
        }
        "stop_protection" => {
            protecting.store(false, Ordering::SeqCst);
            info!("Protection stopped");
            Some(serde_json::json!({ "ok": true, "command": "stop_protection" }))
        }
        "get_status" => {
            let status = StatusResponse {
                status: if protecting.load(Ordering::SeqCst) { "protecting".to_string() } else { "idle".to_string() },
                protecting: protecting.load(Ordering::SeqCst),
                platform: std::env::consts::OS.to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            };
            Some(serde_json::to_value(status).unwrap())
        }
        unknown => {
            warn!("Unknown command: {}", unknown);
            Some(serde_json::json!({ "error": "unknown command", "command": unknown }))
        }
    }
}

// ── DRM Policy Application ─────────────────────────────────────────────────

fn apply_drm_policy() {
    #[cfg(target_os = "linux")]
    {
        info!("Linux: attempting to detect pipewire/wayland screensharing sessions");
    }
    #[cfg(target_os = "macos")]
    {
        info!("macOS: NSWindowSharingNone policy would be applied by main Electron process");
    }
    #[cfg(target_os = "windows")]
    {
        info!("Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) applied by Electron main process");
    }
}

// ── Scanner Loop ───────────────────────────────────────────────────────────

/// Continuously scans for threats while protection is active.
/// In development mode, also emits mock events for integration testing.
async fn scanner_loop(
    tx: broadcast::Sender<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    let mut tick = 0u64;

    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        if !protecting.load(Ordering::SeqCst) { continue; }

        tick += 1;

        // --- Real checks ---
        check_remote_session(&tx);
        check_process_list(&tx).await;

        // --- Mock events for integration testing in DEV ---
        #[cfg(debug_assertions)]
        {
             let mut rng = rand::thread_rng();
            let mock_event = match rng.gen_range(0..10) {
                0 => Some(TelemetryEvent::new(
                    "screen_capture_attempt", "HIGH",
                    serde_json::json!({ "method": "DXGI_desktop_duplication", "source": "mock" }),
                )),
                1 => Some(TelemetryEvent::new(
                    "process_detected", "MEDIUM",
                    serde_json::json!({ "process": "AnyDesk", "pid": 1234, "source": "mock" }),
                )),
                2 => Some(TelemetryEvent::new(
                    "multi_monitor_detected", "MEDIUM",
                    serde_json::json!({ "monitor_count": 2, "source": "mock" }),
                )),
                3 if tick % 5 == 0 => Some(TelemetryEvent::new(
                    "remote_session_detected", "HIGH",
                    serde_json::json!({ "method": "RDP", "source": "mock" }),
                )),
                _ => None,
            };

            if let Some(ev) = mock_event {
                info!("📤 [MOCK] Emitting: {} [{}]", ev.event_type, ev.severity);
                let _ = tx.send(ev);
            }
        }

        // Heartbeat status event every 30 seconds
        if tick % 6 == 0 {
            let _ = tx.send(TelemetryEvent::new(
                "daemon_heartbeat", "LOW",
                serde_json::json!({ "tick": tick, "platform": std::env::consts::OS }),
            ));
        }
    }
}

// ── Platform Checks ────────────────────────────────────────────────────────

fn check_remote_session(tx: &broadcast::Sender<TelemetryEvent>) {
    // Linux/macOS: check for SSH_CONNECTION environment variable
    #[cfg(unix)]
    {
        if std::env::var("SSH_CONNECTION").is_ok() {
            warn!("SSH_CONNECTION detected — potential remote session");
            let _ = tx.send(TelemetryEvent::new(
                "remote_session_detected", "HIGH",
                serde_json::json!({ "method": "SSH", "env": "SSH_CONNECTION" }),
            ));
        }
    }

    // Windows: check SESSIONNAME env var (set to "Console" for local, "RDP-Tcp#N" for RDP)
    #[cfg(windows)]
    {
        if let Ok(session_name) = std::env::var("SESSIONNAME") {
            if session_name.to_uppercase().starts_with("RDP") {
                warn!("RDP session detected (SESSIONNAME={})", session_name);
                let _ = tx.send(TelemetryEvent::new(
                    "remote_session_detected", "HIGH",
                    serde_json::json!({ "method": "RDP", "session": session_name }),
                ));
            }
        }
    }
}

async fn check_process_list(tx: &broadcast::Sender<TelemetryEvent>) {
    let blacklist = [
        "anydesk", "teamviewer", "vncviewer", "vncserver", "xrdp",
        "obs64", "obs32", "obs", "obs-studio", "discord",
        "screenconnect", "logmein", "ammyy", "remotepc", "telegram", "whatsapp",
    ];

    // Linux: read /proc filesystem
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = tokio::fs::read_dir("/proc").await {
            let mut entries = entries;
            while let Ok(Some(entry)) = entries.next_entry().await {
                let pid_str = entry.file_name();
                let pid_str = pid_str.to_string_lossy();
                if pid_str.chars().all(|c| c.is_ascii_digit()) {
                    let comm_path = format!("/proc/{}/comm", pid_str);
                    if let Ok(comm) = tokio::fs::read_to_string(&comm_path).await {
                        let comm = comm.trim().to_lowercase();
                        for bl in &blacklist {
                            if comm.contains(bl) {
                                warn!("Blacklisted process detected: {} (pid={})", comm, pid_str);
                                let _ = tx.send(TelemetryEvent::new(
                                    "process_detected", "MEDIUM",
                                    serde_json::json!({ "process": comm, "pid": pid_str }),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    // Windows: use `tasklist.exe` to enumerate running processes
    #[cfg(windows)]
    {
        use std::process::Command;
        match Command::new("tasklist")
            .args(["/fo", "csv", "/nh"])
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    // CSV format: "process.exe","PID","Session","Num","Mem"
                    let name = line.split(',').next().unwrap_or("").trim_matches('"').to_lowercase();
                    // Strip .exe suffix for comparison
                    let name_no_ext = name.trim_end_matches(".exe");
                    for bl in &blacklist {
                        if name_no_ext.contains(bl) {
                            warn!("Blacklisted process detected: {}", name);
                            let _ = tx.send(TelemetryEvent::new(
                                "process_detected", "MEDIUM",
                                serde_json::json!({ "process": name, "source": "tasklist" }),
                            ));
                        }
                    }
                }
            }
            Err(e) => {
                warn!("Failed to run tasklist: {}", e);
            }
        }
    }

    // macOS: use `ps` to enumerate running processes
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("ps").args(["-ax", "-o", "comm="]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim().to_lowercase();
                for bl in &blacklist {
                    if name.contains(bl) {
                        warn!("Blacklisted process detected: {}", name);
                        let _ = tx.send(TelemetryEvent::new(
                            "process_detected", "MEDIUM",
                            serde_json::json!({ "process": name, "source": "ps" }),
                        ));
                    }
                }
            }
        }
    }
}
