use serde::{Deserialize, Serialize};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, State};

/// Connection details handed to the Svelte Desktop Client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarConnection {
    pub port: u16,
    pub token: String,
}

/// Managed sidecar process state.
struct SidecarProcess {
    child: Option<Child>,
    connection: Option<SidecarConnection>,
}

impl SidecarProcess {
    fn new() -> Self {
        Self {
            child: None,
            connection: None,
        }
    }
}

/// Generate a random hex token for sidecar auth.
fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let hasher = RandomState::new().build_hasher();
    let mut state = hasher;
    // Mix in some entropy
    state.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
    state.write_u64(std::process::id() as u64);
    format!("{:016x}{:016x}", state.finish(), state.finish())
}

/// Start the sidecar process and wait for its connection info.
#[tauri::command]
fn start_sidecar(
    state: State<'_, Mutex<SidecarProcess>>,
    app_handle: tauri::AppHandle,
) -> Result<SidecarConnection, String> {
    let mut proc = state.lock().map_err(|e| e.to_string())?;

    if proc.child.is_some() {
        return Err("Sidecar is already running".to_string());
    }

    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    let token = generate_token();

    // Use Node as the runtime (fallback; Bun can be substituted)
    let node_path = std::env::var("PI_SIDECAR_NODE")
        .unwrap_or_else(|_| "node".to_string());

    let sidecar_script = std::env::var("PI_SIDECAR_SCRIPT")
        .unwrap_or_else(|_| {
            // Default: the sidecar package's run.ts via tsx
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
                .unwrap_or_else(|_| ".".to_string());
            format!(
                "{}/../../packages/sidecar/src/run.ts",
                manifest_dir
            )
        });

    let mut child = Command::new(&node_path)
        .args(["--import", "tsx", &sidecar_script])
        .env("PI_SIDECAR_TOKEN", &token)
        .env("PI_SIDECAR_PORT", "0")
        .env("PI_SIDECAR_DATA_DIR", &data_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start sidecar: {}", e))?;

    // Read the first line of stdout for connection info (JSON)
    use std::io::{BufRead, BufReader};
    let stdout = child.stdout.take().ok_or("No stdout from sidecar")?;
    let reader = BufReader::new(stdout);
    let line = reader
        .lines()
        .next()
        .ok_or("Sidecar exited before sending connection info")?
        .map_err(|e| format!("Failed to read sidecar output: {}", e))?;

    let conn: SidecarConnection =
        serde_json::from_str(&line).map_err(|e| format!("Invalid sidecar output: {}", e))?;

    // Store the connection and child process
    proc.connection = Some(conn.clone());
    proc.child = Some(child);

    Ok(conn)
}

/// Get the current sidecar connection info.
#[tauri::command]
fn get_sidecar_connection(
    state: State<'_, Mutex<SidecarProcess>>,
) -> Result<SidecarConnection, String> {
    let proc = state.lock().map_err(|e| e.to_string())?;
    proc.connection
        .clone()
        .ok_or_else(|| "Sidecar not started".to_string())
}

/// Stop the sidecar process.
#[tauri::command]
fn stop_sidecar(state: State<'_, Mutex<SidecarProcess>>) -> Result<(), String> {
    let mut proc = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = proc.child.take() {
        child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        let _ = child.wait();
    }
    proc.connection = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SidecarProcess::new()))
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            get_sidecar_connection,
            stop_sidecar,
        ])
        .on_window_event(|_window, event| {
            // Track window lifecycle but actual sidecar cleanup is on RunEvent
            let _ = event;
        })
        .build(tauri::generate_context!())
        .expect("error while building Pi Desktop")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Mutex<SidecarProcess>>() {
                    let guard = state.lock().ok();
                    if let Some(mut proc) = guard {
                        if let Some(mut child) = proc.child.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
