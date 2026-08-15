use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BaltoStatus {
    phase: String,
    stage: Option<String>,
    message: String,
    progress: u8,
    started_at: Option<String>,
    downloaded_gb: Option<f64>,
    download_total_gb: Option<f64>,
    download_rate_mbps: Option<f64>,
    eta_seconds: Option<u64>,
    gpu_name: Option<String>,
    gpu_memory_mib: Option<u64>,
    gpu_memory_used_mib: Option<u64>,
    docker_installed: bool,
    docker_ready: bool,
    tailscale_installed: bool,
    tailscale_signed_in: bool,
    tailscale_dns_name: Option<String>,
    remote_enabled: bool,
    remote_url: Option<String>,
    inference_ready: bool,
    workspace_ready: bool,
    context_window: Option<u64>,
    warning: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    current_version: String,
    available_version: Option<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Cannot resolve Balto data directory: {error}"))
}

fn resource_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|path| path.join("runtime"))
        .map_err(|error| format!("Cannot resolve Balto runtime resources: {error}"))
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("state.json"))
}

fn runtime_command(app: &AppHandle, action: &str) -> Result<Command, String> {
    let app_data = app_data_dir(app)?;
    fs::create_dir_all(&app_data)
        .map_err(|error| format!("Cannot create {}: {error}", app_data.display()))?;
    let resources = resource_runtime_dir(app)?;
    let script = resources.join("balto.sh");
    if !script.exists() {
        return Err(format!("Missing packaged runtime: {}", script.display()));
    }
    let mut command = Command::new("/bin/zsh");
    command
        .arg(script)
        .arg(action)
        .arg(&app_data)
        .arg(&resources)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(command)
}

fn read_status(app: &AppHandle) -> Result<BaltoStatus, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(BaltoStatus {
            phase: "not-installed".into(),
            stage: Some("system-check".into()),
            message: "Ready to prepare Balto on this Mac.".into(),
            download_total_gb: Some(18.0),
            ..Default::default()
        });
    }
    let body = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    serde_json::from_str(&body).map_err(|error| format!("Invalid Balto state: {error}"))
}

fn run_action_sync(app: &AppHandle, action: &str) -> Result<(), String> {
    let status = runtime_command(app, action)?
        .status()
        .map_err(|error| format!("Could not run Balto action '{action}': {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Balto action '{action}' exited with {status}"))
    }
}

fn spawn_action(app: &AppHandle, action: &str) -> Result<(), String> {
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        return Err("Balto is shutting down.".into());
    }
    let mut command = runtime_command(app, action)?;
    command.process_group(0);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start Balto action '{action}': {error}"))
}

fn stop_everything(app: &AppHandle) {
    if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = run_action_sync(app, "stop");
}

#[cfg(target_os = "macos")]
fn install_from_disk_image() -> Result<bool, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Cannot locate the running Balto app: {error}"))?;
    let bundle = executable
        .ancestors()
        .find(|ancestor| {
            ancestor
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .ok_or_else(|| "Cannot locate the Balto application bundle.".to_string())?;
    let volumes = Path::new("/Volumes");
    let relative = match bundle.strip_prefix(volumes) {
        Ok(relative) => relative,
        Err(_) => return Ok(false),
    };
    let volume_name = relative
        .components()
        .next()
        .ok_or_else(|| "Cannot locate the Balto installer disk.".to_string())?;
    let volume = volumes.join(volume_name.as_os_str());
    let installed = PathBuf::from("/Applications/Balto Speedrunner.app");

    let copied = Command::new("/usr/bin/ditto")
        .arg(bundle)
        .arg(&installed)
        .status()
        .map_err(|error| format!("Could not copy Balto into Applications: {error}"))?;
    if !copied.success() {
        return Err(format!("Could not copy Balto into Applications: {copied}"));
    }

    let verified = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&installed)
        .status()
        .map_err(|error| format!("Could not verify the installed Balto app: {error}"))?;
    if !verified.success() {
        return Err("The installed Balto app did not pass signature verification.".into());
    }

    Command::new("/bin/sh")
        .arg("-c")
        .arg("sleep 1; /usr/bin/open -n \"$1\"; sleep 2; /usr/sbin/diskutil eject \"$2\" >/dev/null 2>&1 || true")
        .arg("balto-self-installer")
        .arg(&installed)
        .arg(&volume)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not launch the installed Balto app: {error}"))?;
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
fn install_from_disk_image() -> Result<bool, String> {
    Ok(false)
}

fn run_service_watchdog(app: AppHandle) {
    thread::spawn(move || {
        loop {
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                break;
            }
            let should_check = read_status(&app)
                .map(|status| matches!(status.phase.as_str(), "ready" | "degraded"))
                .unwrap_or(false);
            if should_check {
                let _ = run_action_sync(&app, "status");
            }
            thread::sleep(Duration::from_secs(5));
        }
    });
}

#[tauri::command]
fn get_status(app: AppHandle) -> Result<BaltoStatus, String> {
    read_status(&app)
}

#[tauri::command]
fn setup_stack(app: AppHandle) -> Result<(), String> {
    spawn_action(&app, "setup")
}

#[tauri::command]
fn start_stack(app: AppHandle) -> Result<(), String> {
    spawn_action(&app, "start")
}

#[tauri::command]
fn stop_stack(app: AppHandle) -> Result<(), String> {
    run_action_sync(&app, "stop")
}

#[tauri::command]
fn read_log(app: AppHandle) -> Result<String, String> {
    let path = app_data_dir(&app)?.join("balto.log");
    if !path.exists() {
        return Ok("Waiting for setup to begin.".into());
    }
    let body = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let mut lines = body.lines().rev().take(400).collect::<Vec<_>>();
    lines.reverse();
    Ok(lines.join("\n"))
}

#[tauri::command]
fn open_privacy_settings(kind: String) -> Result<(), String> {
    let pane = match kind.as_str() {
        "accessibility" => "Privacy_Accessibility",
        "screen" => "Privacy_ScreenCapture",
        _ => return Err("Unknown privacy setting.".into()),
    };
    Command::new("/usr/bin/open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .status()
        .map_err(|error| format!("Could not open System Settings: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "System Settings did not open.".to_string())
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    let available_version = app
        .updater()
        .map_err(|error| format!("Could not initialize updates: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))?
        .map(|update| update.version);
    Ok(UpdateStatus {
        current_version,
        available_version,
    })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| format!("Could not initialize updates: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))?
        .ok_or_else(|| "Balto Speedrunner is already current.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("The signed update could not be installed: {error}"))?;
    stop_everything(&app);
    app.request_restart();
    Ok(())
}

#[tauri::command]
fn open_workspace(app: AppHandle, fresh: Option<bool>) -> Result<(), String> {
    if !read_status(&app)?.workspace_ready {
        return Err("Balto is still starting.".into());
    }
    navigate_to_workspace(&app, fresh.unwrap_or(false))
}

fn navigate_to_workspace(app: &AppHandle, fresh: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Balto window is unavailable.".to_string())?;
    let workspace_url = if fresh {
        "http://127.0.0.1:3080/?balto=new"
    } else {
        "http://127.0.0.1:3080/"
    };
    window
        .navigate(workspace_url.parse().map_err(|_| "Invalid workspace URL")?)
        .map_err(|error| format!("Could not open the Balto workspace: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            if install_from_disk_image()? {
                SHUTTING_DOWN.store(true, Ordering::SeqCst);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                app.handle().exit(0);
                return Ok(());
            }
            run_service_watchdog(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                stop_everything(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_status,
            setup_stack,
            start_stack,
            stop_stack,
            read_log,
            open_privacy_settings,
            check_for_updates,
            install_update,
            open_workspace
        ])
        .build(tauri::generate_context!())
        .expect("error while building Balto Speedrunner");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_everything(app_handle);
        }
    });
}
