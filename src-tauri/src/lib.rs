fn project_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let directory = app.path().document_dir().map_err(|e| e.to_string())?.join("Alpha Solve App");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

fn workspace_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = project_directory(app)?.join("Projects");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

fn valid_project_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[tauri::command]
fn scan_workspace_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let directory = workspace_directory(&app)?;
    let mut paths = std::fs::read_dir(directory).map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("asolve"))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths.into_iter().filter_map(|path| std::fs::read_to_string(path).ok()).collect())
}

#[tauri::command]
fn persist_workspace_project(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    if !valid_project_id(&id) { return Err("Invalid project identifier".into()); }
    let directory = workspace_directory(&app)?;
    let destination = directory.join(format!("{}.asolve", id));
    let temporary = directory.join(format!("{}.asolve.tmp", id));
    std::fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    if destination.exists() { std::fs::remove_file(&destination).map_err(|e| e.to_string())?; }
    std::fs::rename(temporary, destination).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_workspace_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_project_id(&id) { return Err("Invalid project identifier".into()); }
    let path = workspace_directory(&app)?.join(format!("{}.asolve", id));
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn save_document(app: tauri::AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    let directory = project_directory(&app)?;
    let file = rfd::AsyncFileDialog::new().set_directory(directory).set_file_name(&name).save_file().await;
    match file {
        Some(file) => {
            std::fs::write(file.path(), contents).map_err(|e| e.to_string())?;
            Ok(Some(file.path().to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn open_document(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let directory = project_directory(&app)?;
    let file = rfd::AsyncFileDialog::new().set_directory(directory)
        .add_filter("Alpha Solve projects and systems", &["asolve", "json"]).pick_file().await;
    match file {
        Some(file) => std::fs::read_to_string(file.path()).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_document, open_document, scan_workspace_projects,
            persist_workspace_project, delete_workspace_project])
        .run(tauri::generate_context!())
        .expect("error while running Alpha Solve");
}
