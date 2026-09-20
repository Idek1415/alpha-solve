fn project_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let directory = app.path().document_dir().map_err(|e| e.to_string())?.join("Alpha Solve App");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
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
        .invoke_handler(tauri::generate_handler![save_document, open_document])
        .run(tauri::generate_context!())
        .expect("error while running Alpha Solve");
}
