//! AntiCheat Security Daemon
//!
//! This daemon runs as a user-level service alongside the Electron exam client.
//! It performs OS-level checks and reports security events via a Unix Domain Socket
//! (or Named Pipe on Windows) to the Electron parent process.
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
use tokio::net::{UnixListener, UnixStream};
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

// ── Socket Path ────────────────────────────────────────────────────────────

fn socket_path() -> &'static str {
    "/tmp/anticheat_daemon.sock"
}

// ── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .init();

    // Remove stale socket file
    let _ = std::fs::remove_file(socket_path());

    let listener = UnixListener::bind(socket_path())
        .expect("Failed to bind Unix socket");
    info!("🔐 AntiCheat Daemon listening on {}", socket_path());

    let (event_tx, _) = broadcast::channel::<TelemetryEvent>(256);
    let protecting = Arc::new(AtomicBool::new(false));

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let tx = event_tx.clone();
                let rx = event_tx.subscribe();
                let protecting_clone = Arc::clone(&protecting);
                tokio::spawn(handle_client(stream, tx, rx, protecting_clone));
            }
            Err(e) => {
                error!("Accept error: {}", e);
            }
        }
    }
}

// ── Client Handler ─────────────────────────────────────────────────────────

async fn handle_client(
    stream: UnixStream,
    event_tx: broadcast::Sender<TelemetryEvent>,
    mut event_rx: broadcast::Receiver<TelemetryEvent>,
    protecting: Arc<AtomicBool>,
) {
    info!("Client connected");
    let (read_half, mut write_half) = stream.into_split();
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
        // In production: check /proc or dbus for pipewire-portal screenshare sessions
        // and kill or block them based on policy.
    }
    #[cfg(target_os = "macos")]
    {
        info!("macOS: NSWindowSharingNone policy would be applied by main Electron process");
        // Electron's main process handles this for the BrowserWindow.
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
    let mut rng = rand::thread_rng();
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
    // Linux: check for SSH_CONNECTION or DISPLAY pointing to remote
    #[cfg(target_os = "linux")]
    {
        if std::env::var("SSH_CONNECTION").is_ok() {
            warn!("SSH_CONNECTION detected — potential remote session");
            let _ = tx.send(TelemetryEvent::new(
                "remote_session_detected", "HIGH",
                serde_json::json!({ "method": "SSH", "env": "SSH_CONNECTION" }),
            ));
        }
    }
    // Windows: GetSystemMetrics(SM_REMOTESESSION)
    // This would require windows-sys crate in production
    #[cfg(target_os = "windows")]
    {
        // TODO: use winapi::um::winuser::GetSystemMetrics(SM_REMOTESESSION)
    }
}

async fn check_process_list(tx: &broadcast::Sender<TelemetryEvent>) {
    // Read /proc to list running processes on Linux
    #[cfg(target_os = "linux")]
    {
        let blacklist = [
            "anydesk", "teamviewer", "vnc", "xrdp",
            "obs", "obs-studio", "screencast", "discord",
        ];
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
}
