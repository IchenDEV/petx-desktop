use std::{
    fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use super::{
    model::{ActivePetRef, ActivePetSource, InstallationRecord, PetManifest, ResolvedActivePet},
    now_epoch_nanos, source_scoped_key, validate_pet_manifest, validate_slug, validate_spritesheet,
    MAX_PET_JSON_BYTES, MAX_SPRITESHEET_BYTES,
};

const ACTIVE_PET_FILE: &str = "active-pet.json";
const BUILTIN_PET_ID: &str = "frieren";
const BUILTIN_MANIFEST_URL: &str = "/pets/frieren/pet.json";
const ACTIVE_PET_CHANGED_EVENT: &str = "petx://active-pet-changed";
const MAX_INSTALLATION_RECORD_BYTES: usize = 64 * 1024;

#[tauri::command]
pub fn get_active_pet(app: AppHandle) -> ResolvedActivePet {
    let Ok(data_root) = app.path().app_data_dir() else {
        return builtin_pet();
    };
    load_resolved_active_pet(&data_root)
}

#[tauri::command]
pub fn set_active_pet(
    app: AppHandle,
    source: String,
    slug: String,
) -> Result<ResolvedActivePet, String> {
    let source = parse_source(&source)?;
    validate_slug(&slug)?;
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位当前宠物存档：{error}"))?;
    let resolved = set_active_pet_at(&data_root, source, &slug)?;
    emit_active_pet_changed(&app, &resolved);
    Ok(resolved)
}

#[tauri::command]
pub fn reset_active_pet(app: AppHandle) -> Result<ResolvedActivePet, String> {
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位当前宠物存档：{error}"))?;
    let resolved = reset_active_pet_at(&data_root)?;
    emit_active_pet_changed(&app, &resolved);
    Ok(resolved)
}

fn emit_active_pet_changed(app: &AppHandle, resolved: &ResolvedActivePet) {
    if let Err(error) = app.emit(ACTIVE_PET_CHANGED_EVENT, resolved) {
        eprintln!("failed to notify windows about the active pet: {error}");
    }
}

fn parse_source(source: &str) -> Result<ActivePetSource, String> {
    match source {
        "petdex" => Ok(ActivePetSource::Petdex),
        "petshare" => Ok(ActivePetSource::Petshare),
        _ => Err("当前宠物来源不受支持。".to_string()),
    }
}

fn load_resolved_active_pet(data_root: &Path) -> ResolvedActivePet {
    let path = active_pet_path(data_root);
    let reference = match read_active_ref(&path) {
        Ok(Some(reference)) => reference,
        Ok(None) => return builtin_pet(),
        Err(error) => {
            eprintln!(
                "ignoring invalid active pet record {}: {error}",
                path.display()
            );
            repair_to_builtin(&path);
            return builtin_pet();
        }
    };

    match reference {
        ActivePetRef::Builtin { id } if id == BUILTIN_PET_ID => builtin_pet(),
        ActivePetRef::Builtin { .. } => {
            repair_to_builtin(&path);
            builtin_pet()
        }
        ActivePetRef::Installed { source, slug } => {
            match resolve_installed_pet(&data_root.join("pets"), source, &slug) {
                Ok(resolved) => resolved,
                Err(error) => {
                    eprintln!("falling back from unavailable active pet: {error}");
                    repair_to_builtin(&path);
                    builtin_pet()
                }
            }
        }
    }
}

fn set_active_pet_at(
    data_root: &Path,
    source: ActivePetSource,
    slug: &str,
) -> Result<ResolvedActivePet, String> {
    let resolved = resolve_installed_pet(&data_root.join("pets"), source, slug)?;
    let reference = ActivePetRef::Installed {
        source,
        slug: slug.to_string(),
    };
    write_active_ref(&active_pet_path(data_root), &reference)?;
    Ok(resolved)
}

fn reset_active_pet_at(data_root: &Path) -> Result<ResolvedActivePet, String> {
    write_active_ref(&active_pet_path(data_root), &builtin_ref())?;
    Ok(builtin_pet())
}

fn read_active_ref(path: &Path) -> Result<Option<ActivePetRef>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取当前宠物存档：{error}")),
    };
    if bytes.len() > MAX_PET_JSON_BYTES {
        return Err("当前宠物存档超过安全大小限制。".to_string());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("当前宠物存档格式无效：{error}"))
}

fn resolve_installed_pet(
    pets_root: &Path,
    source: ActivePetSource,
    slug: &str,
) -> Result<ResolvedActivePet, String> {
    validate_slug(slug)?;
    let directory = installed_pet_directory(pets_root, source, slug)
        .ok_or_else(|| "这只宠物还没有收进本地宠物库。".to_string())?;

    let manifest_bytes = read_limited_file(
        &directory.join("pet.json"),
        MAX_PET_JSON_BYTES,
        "本地宠物清单",
    )?;
    let manifest: PetManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("本地宠物清单无效：{error}"))?;
    validate_pet_manifest(&manifest)?;

    let installation_bytes = read_limited_file(
        &directory.join("installation.json"),
        MAX_INSTALLATION_RECORD_BYTES,
        "本地宠物来源记录",
    )?;
    let installation: InstallationRecord = serde_json::from_slice(&installation_bytes)
        .map_err(|error| format!("本地宠物来源记录无效：{error}"))?;
    validate_installed_identity(&manifest, &installation, source, slug)?;
    if source == ActivePetSource::Petshare
        && (manifest.sprite_version_number != Some(2)
            || manifest.spritesheet_path != "spritesheet.webp")
    {
        return Err("Petshare 本地宠物必须保持 V2 WebP 格式。".to_string());
    }

    let sprite_path = directory.join(&manifest.spritesheet_path);
    let spritesheet_bytes = read_limited_file(&sprite_path, MAX_SPRITESHEET_BYTES, "本地宠物图集")?;
    validate_spritesheet(&spritesheet_bytes, &manifest)?;
    let sha256 = format!("{:x}", Sha256::digest(&spritesheet_bytes));
    if installation.sha256 != sha256 {
        return Err("本地宠物图集与收藏时的文件摘要不一致。".to_string());
    }

    Ok(ResolvedActivePet {
        reference: ActivePetRef::Installed {
            source,
            slug: slug.to_string(),
        },
        id: manifest.id,
        display_name: manifest.display_name,
        description: manifest.description,
        sprite_version_number: manifest.sprite_version_number.unwrap_or(1),
        sprite_path: Some(sprite_path.to_string_lossy().into_owned()),
        manifest_url: None,
    })
}

fn installed_pet_directory(
    pets_root: &Path,
    source: ActivePetSource,
    slug: &str,
) -> Option<PathBuf> {
    let scoped = pets_root.join(source_scoped_key(source.as_str(), slug));
    if scoped.is_dir() {
        return Some(scoped);
    }
    if source == ActivePetSource::Petdex {
        let legacy = pets_root.join(slug);
        if legacy.is_dir() {
            return Some(legacy);
        }
    }
    None
}

fn validate_installed_identity(
    manifest: &PetManifest,
    installation: &InstallationRecord,
    source: ActivePetSource,
    slug: &str,
) -> Result<(), String> {
    if installation.source != source.as_str()
        || installation.remote_id != slug
        || manifest.id != slug
    {
        return Err("本地宠物清单、来源记录与所选身份不一致。".to_string());
    }
    if installation
        .display_name
        .as_ref()
        .is_some_and(|display_name| display_name != &manifest.display_name)
    {
        return Err("本地宠物显示名称与收藏记录不一致。".to_string());
    }
    Ok(())
}

fn read_limited_file(path: &Path, maximum: usize, label: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取{label} {}：{error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum as u64 {
        return Err(format!("{label}不存在、为空或超过安全大小限制。"));
    }
    fs::read(path).map_err(|error| format!("无法读取{label} {}：{error}", path.display()))
}

fn write_active_ref(path: &Path, reference: &ActivePetRef) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(reference)
        .map_err(|error| format!("无法整理当前宠物存档：{error}"))?;
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "当前宠物存档路径无效。".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "当前宠物存档文件名无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建当前宠物存档目录：{error}"))?;

    let nonce = now_epoch_nanos()?;
    let temporary = parent.join(format!(".{file_name}-{}-{nonce}.tmp", std::process::id()));
    let backup = parent.join(format!(".{file_name}-{}-{nonce}.bak", std::process::id()));
    fs::write(&temporary, bytes).map_err(|error| format!("无法暂存当前宠物设置：{error}"))?;

    if fs::rename(&temporary, path).is_ok() {
        return Ok(());
    }
    if path.exists() && fs::rename(path, &backup).is_ok() {
        match fs::rename(&temporary, path) {
            Ok(()) => {
                let _ = fs::remove_file(backup);
                return Ok(());
            }
            Err(error) => {
                let _ = fs::rename(backup, path);
                let _ = fs::remove_file(temporary);
                return Err(format!("无法替换当前宠物存档：{error}"));
            }
        }
    }
    let _ = fs::remove_file(temporary);
    Err("无法替换当前宠物存档。".to_string())
}

fn repair_to_builtin(path: &Path) {
    if let Err(error) = write_active_ref(path, &builtin_ref()) {
        eprintln!("failed to repair the active pet record: {error}");
    }
}

fn active_pet_path(data_root: &Path) -> PathBuf {
    data_root.join(ACTIVE_PET_FILE)
}

fn builtin_ref() -> ActivePetRef {
    ActivePetRef::Builtin {
        id: BUILTIN_PET_ID.to_string(),
    }
}

fn builtin_pet() -> ResolvedActivePet {
    ResolvedActivePet {
        reference: builtin_ref(),
        id: BUILTIN_PET_ID.to_string(),
        display_name: "Frieren".to_string(),
        description: Some("A quiet white-haired desktop companion.".to_string()),
        sprite_version_number: 2,
        sprite_path: None,
        manifest_url: Some(BUILTIN_MANIFEST_URL.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::DynamicImage;

    use super::*;

    #[test]
    fn active_reference_round_trips_atomically_without_persisting_a_path() {
        let root = test_root("roundtrip");
        let path = active_pet_path(&root);
        let installed = ActivePetRef::Installed {
            source: ActivePetSource::Petshare,
            slug: "same-pet".to_string(),
        };

        write_active_ref(&path, &installed).unwrap();
        assert_eq!(read_active_ref(&path).unwrap(), Some(installed.clone()));
        write_active_ref(&path, &builtin_ref()).unwrap();
        assert_eq!(read_active_ref(&path).unwrap(), Some(builtin_ref()));

        let serialized = String::from_utf8(fs::read(path).unwrap()).unwrap();
        assert!(!serialized.contains("path"));
        assert!(!serialized.contains("sha256"));
        assert!(!serialized.contains("displayName"));
        cleanup(&root);
    }

    #[test]
    fn same_slug_from_different_sources_resolves_to_distinct_installs() {
        let root = test_root("source-scope");
        write_installed_fixture(&root, ActivePetSource::Petdex, "same-pet", "Petdex Pet");
        write_installed_fixture(&root, ActivePetSource::Petshare, "same-pet", "Petshare Pet");

        let petdex = set_active_pet_at(&root, ActivePetSource::Petdex, "same-pet").unwrap();
        let petshare = set_active_pet_at(&root, ActivePetSource::Petshare, "same-pet").unwrap();

        assert_eq!(petdex.display_name, "Petdex Pet");
        assert_eq!(petshare.display_name, "Petshare Pet");
        assert_ne!(petdex.sprite_path, petshare.sprite_path);
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(ActivePetRef::Installed {
                source: ActivePetSource::Petshare,
                slug: "same-pet".to_string(),
            })
        );
        let restored = load_resolved_active_pet(&root);
        assert_eq!(restored.reference, petshare.reference);
        assert_eq!(restored.display_name, "Petshare Pet");
        assert_eq!(restored.sprite_path, petshare.sprite_path);
        cleanup(&root);
    }

    #[test]
    fn unavailable_or_damaged_active_install_falls_back_and_repairs_the_record() {
        let root = test_root("fallback");
        write_active_ref(
            &active_pet_path(&root),
            &ActivePetRef::Installed {
                source: ActivePetSource::Petdex,
                slug: "missing-pet".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            load_resolved_active_pet(&root).reference,
            builtin_ref(),
            "an uninstalled active identity must not escape the safe fallback"
        );
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(builtin_ref())
        );

        let directory =
            write_installed_fixture(&root, ActivePetSource::Petdex, "broken-pet", "Broken Pet");
        write_active_ref(
            &active_pet_path(&root),
            &ActivePetRef::Installed {
                source: ActivePetSource::Petdex,
                slug: "broken-pet".to_string(),
            },
        )
        .unwrap();
        fs::remove_file(directory.join("spritesheet.png")).unwrap();

        assert_eq!(load_resolved_active_pet(&root).reference, builtin_ref());
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(builtin_ref())
        );
        cleanup(&root);
    }

    #[test]
    fn set_rejects_uninstalled_or_identity_mismatched_pets_without_changing_selection() {
        let root = test_root("reject");
        reset_active_pet_at(&root).unwrap();
        assert!(set_active_pet_at(&root, ActivePetSource::Petdex, "not-installed").is_err());
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(builtin_ref())
        );

        let directory = write_installed_fixture(
            &root,
            ActivePetSource::Petdex,
            "expected-pet",
            "Expected Pet",
        );
        let mut installation: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("installation.json")).unwrap())
                .unwrap();
        installation["remoteId"] = serde_json::Value::String("another-pet".to_string());
        fs::write(
            directory.join("installation.json"),
            serde_json::to_vec(&installation).unwrap(),
        )
        .unwrap();

        assert!(set_active_pet_at(&root, ActivePetSource::Petdex, "expected-pet").is_err());
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(builtin_ref())
        );
        cleanup(&root);
    }

    #[test]
    fn active_record_rejects_caller_supplied_paths_instead_of_trusting_them() {
        let injected = br#"{
          "kind": "installed",
          "source": "petdex",
          "slug": "safe-pet",
          "spritePath": "/etc/passwd"
        }"#;

        assert!(serde_json::from_slice::<ActivePetRef>(injected).is_err());
    }

    #[test]
    fn corrupt_active_record_safely_restores_the_builtin_pet() {
        let root = test_root("corrupt-record");
        fs::create_dir_all(&root).unwrap();
        fs::write(active_pet_path(&root), b"{ definitely not json").unwrap();

        let resolved = load_resolved_active_pet(&root);

        assert_eq!(resolved.reference, builtin_ref());
        assert_eq!(
            read_active_ref(&active_pet_path(&root)).unwrap(),
            Some(builtin_ref())
        );
        cleanup(&root);
    }

    fn write_installed_fixture(
        data_root: &Path,
        source: ActivePetSource,
        slug: &str,
        display_name: &str,
    ) -> PathBuf {
        let (version, extension, format) = match source {
            ActivePetSource::Petdex => (1, "png", image::ImageFormat::Png),
            ActivePetSource::Petshare => (2, "webp", image::ImageFormat::WebP),
        };
        let dimensions = super::super::expected_dimensions(Some(version));
        let image = DynamicImage::new_rgba8(dimensions.0, dimensions.1);
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, format).unwrap();
        let spritesheet = encoded.into_inner();
        let sha256 = format!("{:x}", Sha256::digest(&spritesheet));
        let directory = data_root
            .join("pets")
            .join(source_scoped_key(source.as_str(), slug));
        fs::create_dir_all(&directory).unwrap();
        let manifest = PetManifest {
            id: slug.to_string(),
            display_name: display_name.to_string(),
            description: Some(format!("{display_name} description")),
            sprite_version_number: Some(version),
            spritesheet_path: format!("spritesheet.{extension}"),
        };
        let installation = InstallationRecord {
            source: source.as_str().to_string(),
            remote_id: slug.to_string(),
            display_name: Some(display_name.to_string()),
            submitted_by: None,
            source_page_url: "https://example.invalid/pet".to_string(),
            manifest_generated_at: "test".to_string(),
            installed_at_epoch_seconds: 1,
            sha256,
        };
        fs::write(
            directory.join("pet.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            directory.join(format!("spritesheet.{extension}")),
            spritesheet,
        )
        .unwrap();
        fs::write(
            directory.join("installation.json"),
            serde_json::to_vec(&installation).unwrap(),
        )
        .unwrap();
        directory
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "petx-active-{label}-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ))
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }
}
