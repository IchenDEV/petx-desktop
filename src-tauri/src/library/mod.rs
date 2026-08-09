pub(crate) mod active;
mod model;

use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use image::{GenericImageView, ImageReader, Limits};
use reqwest::{header, Client};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

pub use model::{CatalogItem, CatalogResponse, InstalledPet, PetdexPreview};
use model::{
    CompactManifest, InstallationRecord, PetManifest, PetshareCatalogEntry, PetshareManifest,
    PreviewRecord,
};

const MANIFEST_URL: &str = "https://assets.petdex.dev/manifests/petdex-v2.json";
const ASSET_BASE: &str = "https://assets.petdex.dev";
const ASSET_HOST: &str = "assets.petdex.dev";
const MANIFEST_CACHE_FILE: &str = "petdex-manifest-v2.json";
const PREVIEW_CACHE_DIRECTORY: &str = "pet-previews";
const PETSHARE_BASE: &str = "https://petshare.idevlab.dev";
const PETSHARE_HOST: &str = "petshare.idevlab.dev";
const PETSHARE_MANIFEST_URL: &str = "https://petshare.idevlab.dev/pets.json";
const PETSHARE_MANIFEST_CACHE_FILE: &str = "petshare-manifest-v1.json";
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_PETSHARE_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_PET_JSON_BYTES: usize = 64 * 1024;
const MAX_SPRITESHEET_BYTES: usize = 20 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DECODE_ALLOCATION_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PREVIEW_CACHE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PREVIEW_CACHE_ENTRIES: usize = 160;
const MAX_PARALLEL_IMAGE_JOBS: usize = 2;
const LEGACY_FIELDS: [&str; 7] = [
    "slug",
    "displayName",
    "kind",
    "submittedBy",
    "spritesheet",
    "petJson",
    "zip",
];
const CURRENT_FIELDS: [&str; 8] = [
    "slug",
    "displayName",
    "kind",
    "submittedBy",
    "spritesheet",
    "petJson",
    "zip",
    "spriteVersionNumber",
];

#[derive(Clone, Copy)]
enum LibraryProvider {
    Petdex,
    Petshare,
}

impl LibraryProvider {
    fn id(self) -> &'static str {
        match self {
            Self::Petdex => "petdex",
            Self::Petshare => "petshare",
        }
    }

    fn referer(self) -> &'static str {
        match self {
            Self::Petdex => "https://petdex.dev/",
            Self::Petshare => "https://petshare.idevlab.dev/",
        }
    }

    fn validate_url(self, url: &str) -> Result<(), String> {
        match self {
            Self::Petdex => validate_asset_url(url),
            Self::Petshare => validate_petshare_asset_url(url),
        }
    }
}

pub struct LibraryState {
    client: Client,
    petdex_manifest: Mutex<Option<Arc<CompactManifest>>>,
    petshare_manifest: Mutex<Option<Arc<PetshareManifest>>>,
    image_permits: Semaphore,
    preview_cache_lock: AsyncMutex<()>,
}

impl LibraryState {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("PetX-Desktop/0.1")
            .build()
            .map_err(|error| format!("无法初始化宠物库网络连接：{error}"))?;
        Ok(Self {
            client,
            petdex_manifest: Mutex::new(None),
            petshare_manifest: Mutex::new(None),
            image_permits: Semaphore::new(MAX_PARALLEL_IMAGE_JOBS),
            preview_cache_lock: AsyncMutex::new(()),
        })
    }

    fn cached_petdex_manifest(&self) -> Result<Option<Arc<CompactManifest>>, String> {
        self.petdex_manifest
            .lock()
            .map(|manifest| manifest.clone())
            .map_err(|_| "Petdex 目录缓存暂时无法读取。".to_string())
    }

    fn remember_petdex_manifest(&self, manifest: &CompactManifest) -> Result<(), String> {
        let mut cached = self
            .petdex_manifest
            .lock()
            .map_err(|_| "Petdex 目录缓存暂时无法更新。".to_string())?;
        *cached = Some(Arc::new(manifest.clone()));
        Ok(())
    }

    fn cached_petshare_manifest(&self) -> Result<Option<Arc<PetshareManifest>>, String> {
        self.petshare_manifest
            .lock()
            .map(|manifest| manifest.clone())
            .map_err(|_| "Petshare 目录缓存暂时无法读取。".to_string())
    }

    fn remember_petshare_manifest(&self, manifest: &PetshareManifest) -> Result<(), String> {
        let mut cached = self
            .petshare_manifest
            .lock()
            .map_err(|_| "Petshare 目录缓存暂时无法更新。".to_string())?;
        *cached = Some(Arc::new(manifest.clone()));
        Ok(())
    }
}

#[tauri::command]
pub async fn get_petdex_catalog(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<CatalogResponse, String> {
    let (manifest, stale) = load_manifest(&app, &state.client, true).await?;
    state.remember_petdex_manifest(&manifest)?;
    catalog_response(manifest, stale)
}

#[tauri::command]
pub async fn get_petshare_catalog(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<CatalogResponse, String> {
    let (manifest, stale) = load_petshare_manifest(&app, &state.client, true).await?;
    let response = petshare_catalog_response(manifest.clone(), stale)?;
    state.remember_petshare_manifest(&manifest)?;
    Ok(response)
}

#[tauri::command]
pub async fn get_petdex_preview(
    app: AppHandle,
    state: State<'_, LibraryState>,
    slug: String,
) -> Result<PetdexPreview, String> {
    validate_slug(&slug)?;
    let manifest = match state.cached_petdex_manifest()? {
        Some(manifest) => manifest,
        None => {
            let (manifest, _) = load_manifest(&app, &state.client, true).await?;
            state.remember_petdex_manifest(&manifest)?;
            Arc::new(manifest)
        }
    };
    let item = manifest
        .pets
        .iter()
        .find(|item| compact_item_slug(item) == Some(slug.as_str()))
        .cloned()
        .ok_or_else(|| "目录里已经找不到这只宠物，请刷新后再试。".to_string())?;
    let catalog_item = compact_item_to_catalog(&manifest.asset_base, item)?;
    let _image_permit = state
        .image_permits
        .acquire()
        .await
        .map_err(|_| "宠物预览队列暂时不可用。".to_string())?;
    cache_pet_preview(
        &app,
        &state.client,
        &state.preview_cache_lock,
        LibraryProvider::Petdex,
        &catalog_item,
    )
    .await
}

#[tauri::command]
pub async fn get_petshare_preview(
    app: AppHandle,
    state: State<'_, LibraryState>,
    slug: String,
) -> Result<PetdexPreview, String> {
    validate_slug(&slug)?;
    let manifest = match state.cached_petshare_manifest()? {
        Some(manifest) => manifest,
        None => {
            let (manifest, _) = load_petshare_manifest(&app, &state.client, true).await?;
            state.remember_petshare_manifest(&manifest)?;
            Arc::new(manifest)
        }
    };
    let item = manifest
        .iter()
        .find(|item| item.id == slug)
        .cloned()
        .ok_or_else(|| "Petshare 目录里已经找不到这只宠物，请刷新后再试。".to_string())?;
    let catalog_item = petshare_item_to_catalog(item)?;
    let _image_permit = state
        .image_permits
        .acquire()
        .await
        .map_err(|_| "宠物预览队列暂时不可用。".to_string())?;
    cache_pet_preview(
        &app,
        &state.client,
        &state.preview_cache_lock,
        LibraryProvider::Petshare,
        &catalog_item,
    )
    .await
}

#[tauri::command]
pub fn list_installed_pets(app: AppHandle) -> Result<Vec<InstalledPet>, String> {
    let root = pets_root(&app)?;
    list_installed_pets_at(&root)
}

fn list_installed_pets_at(root: &Path) -> Result<Vec<InstalledPet>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut installed = Vec::new();
    let entries = fs::read_dir(root)
        .map_err(|error| format!("无法读取本地宠物库 {}：{error}", root.display()))?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!("failed to inspect a pet library entry: {error}");
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() || entry.file_name() == ".staging" {
            continue;
        }
        match read_installed_pet(&path) {
            Ok(pet) => installed.push(pet),
            Err(error) => eprintln!("ignoring invalid installed pet {}: {error}", path.display()),
        }
    }

    installed.sort_by(|left, right| {
        right
            .last_used_at_epoch_seconds
            .unwrap_or(0)
            .cmp(&left.last_used_at_epoch_seconds.unwrap_or(0))
            .then_with(|| {
                right
                    .installed_at_epoch_seconds
                    .cmp(&left.installed_at_epoch_seconds)
            })
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    Ok(installed)
}

#[tauri::command]
pub fn import_local_pet(app: AppHandle, manifest_path: String) -> Result<InstalledPet, String> {
    if manifest_path.trim().is_empty() {
        return Err("没有选择宠物清单。".to_string());
    }
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位 PetX 本地宠物库：{error}"))?;
    import_local_pet_at(&data_root, Path::new(&manifest_path))
}

fn import_local_pet_at(data_root: &Path, manifest_path: &Path) -> Result<InstalledPet, String> {
    if manifest_path.file_name().and_then(|name| name.to_str()) != Some("pet.json") {
        return Err("请选择解压后宠物文件夹里的 pet.json。".to_string());
    }
    let manifest_bytes =
        read_limited_local_file(manifest_path, MAX_PET_JSON_BYTES, "导入的宠物清单")?;
    let mut manifest: PetManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("导入的 pet.json 不是有效 JSON：{error}"))?;
    validate_pet_manifest(&manifest)?;
    let package_root = manifest_path
        .parent()
        .ok_or_else(|| "导入的宠物清单路径无效。".to_string())?;
    let sprite_path = package_root.join(&manifest.spritesheet_path);
    let spritesheet_bytes =
        read_limited_local_file(&sprite_path, MAX_SPRITESHEET_BYTES, "导入的宠物图集")?;
    validate_spritesheet(&spritesheet_bytes, &manifest)?;

    let sha256 = format!("{:x}", Sha256::digest(&spritesheet_bytes));
    let mut package_hasher = Sha256::new();
    package_hasher.update(&manifest_bytes);
    package_hasher.update(&spritesheet_bytes);
    let slug = format!("local-{:x}", package_hasher.finalize());
    validate_slug(&slug)?;
    manifest.id = slug.clone();

    let installed_at_epoch_seconds = now_epoch_seconds()?;
    let installation = InstallationRecord {
        source: "imported".to_string(),
        remote_id: slug.clone(),
        display_name: Some(manifest.display_name.clone()),
        submitted_by: None,
        source_page_url: String::new(),
        manifest_generated_at: String::new(),
        installed_at_epoch_seconds,
        last_used_at_epoch_seconds: None,
        use_count: 0,
        sha256,
    };

    let root = data_root.join("pets");
    let target = root.join(source_scoped_key("imported", &slug));
    if target.exists() {
        let installed = read_installed_pet(&target)?;
        if installed.source == "imported" && installed.slug == slug {
            return Ok(installed);
        }
        return Err("同一导入身份与现有本地伙伴冲突。".to_string());
    }

    let staging_root = root.join(".staging");
    fs::create_dir_all(&staging_root)
        .map_err(|error| format!("无法创建宠物库暂存目录：{error}"))?;
    let staging = staging_root.join(format!(
        "imported-{}-{}-{}",
        std::process::id(),
        installed_at_epoch_seconds,
        now_epoch_nanos()?
    ));
    fs::create_dir(&staging).map_err(|error| format!("无法准备导入目录：{error}"))?;
    if let Err(error) = write_staged_pet(&staging, &manifest, &installation, &spritesheet_bytes) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        if target.exists() {
            let installed = read_installed_pet(&target)?;
            if installed.source == "imported" && installed.slug == slug {
                return Ok(installed);
            }
        }
        return Err(format!("无法把导入的宠物收进本地库：{error}"));
    }
    read_installed_pet(&target)
}

#[tauri::command]
pub async fn install_petdex_pet(
    app: AppHandle,
    state: State<'_, LibraryState>,
    slug: String,
) -> Result<InstalledPet, String> {
    validate_slug(&slug)?;
    if let Some(installed) = existing_installed_pet(&app, LibraryProvider::Petdex, &slug)? {
        return Ok(installed);
    }

    let manifest = match state.cached_petdex_manifest()? {
        Some(manifest) => manifest,
        None => {
            let (manifest, _) = load_manifest(&app, &state.client, true).await?;
            state.remember_petdex_manifest(&manifest)?;
            Arc::new(manifest)
        }
    };
    let generated_at = manifest.generated_at.clone();
    let item = manifest
        .pets
        .iter()
        .find(|item| compact_item_slug(item) == Some(slug.as_str()))
        .cloned()
        .ok_or_else(|| "目录里已经找不到这只宠物，请刷新后再试。".to_string())?;
    let catalog_item = compact_item_to_catalog(&manifest.asset_base, item)?;
    install_catalog_pet(
        &app,
        &state,
        LibraryProvider::Petdex,
        slug,
        catalog_item,
        generated_at,
    )
    .await
}

#[tauri::command]
pub async fn install_petshare_pet(
    app: AppHandle,
    state: State<'_, LibraryState>,
    slug: String,
) -> Result<InstalledPet, String> {
    validate_slug(&slug)?;
    if let Some(installed) = existing_installed_pet(&app, LibraryProvider::Petshare, &slug)? {
        return Ok(installed);
    }

    let manifest = match state.cached_petshare_manifest()? {
        Some(manifest) => manifest,
        None => {
            let (manifest, _) = load_petshare_manifest(&app, &state.client, true).await?;
            state.remember_petshare_manifest(&manifest)?;
            Arc::new(manifest)
        }
    };
    let item = manifest
        .iter()
        .find(|item| item.id == slug)
        .cloned()
        .ok_or_else(|| "Petshare 目录里已经找不到这只宠物，请刷新后再试。".to_string())?;
    let catalog_item = petshare_item_to_catalog(item)?;
    install_catalog_pet(
        &app,
        &state,
        LibraryProvider::Petshare,
        slug,
        catalog_item,
        String::new(),
    )
    .await
}

async fn install_catalog_pet(
    app: &AppHandle,
    state: &LibraryState,
    provider: LibraryProvider,
    slug: String,
    catalog_item: CatalogItem,
    manifest_generated_at: String,
) -> Result<InstalledPet, String> {
    if let Some(installed) = existing_installed_pet(app, provider, &slug)? {
        return Ok(installed);
    }
    let pet_json_bytes = download_limited(
        &state.client,
        &catalog_item.pet_json_url,
        MAX_PET_JSON_BYTES,
        "宠物清单",
        provider,
    )
    .await?;
    let mut pet_manifest: PetManifest = serde_json::from_slice(&pet_json_bytes)
        .map_err(|error| format!("宠物清单不是有效 JSON：{error}"))?;
    match provider {
        LibraryProvider::Petdex => validate_pet_manifest(&pet_manifest)?,
        LibraryProvider::Petshare => {
            validate_petshare_pet_manifest(&slug, &pet_manifest, &catalog_item)?
        }
    }

    let _image_permit = state
        .image_permits
        .acquire()
        .await
        .map_err(|_| "宠物图集检查队列暂时不可用。".to_string())?;
    let (spritesheet_bytes, preview_record) =
        read_preview_for_install(app, &state.preview_cache_lock, provider, &catalog_item).await?;
    validate_spritesheet(&spritesheet_bytes, &pet_manifest)?;

    let sha256 = preview_record.sha256;
    let installed_at_epoch_seconds = now_epoch_seconds()?;
    let installation = InstallationRecord {
        source: provider.id().to_string(),
        remote_id: slug.clone(),
        display_name: Some(catalog_item.display_name.clone()),
        submitted_by: catalog_item.submitted_by.clone(),
        source_page_url: catalog_item.source_page_url.clone(),
        manifest_generated_at,
        installed_at_epoch_seconds,
        last_used_at_epoch_seconds: None,
        use_count: 0,
        sha256,
    };

    let root = pets_root(app)?;
    let target = root.join(source_scoped_key(provider.id(), &slug));
    fs::create_dir_all(root.join(".staging"))
        .map_err(|error| format!("无法创建宠物库暂存目录：{error}"))?;
    let staging = root.join(".staging").join(format!(
        "{}-{}-{}",
        source_scoped_key(provider.id(), &slug),
        std::process::id(),
        installed_at_epoch_seconds
    ));
    if staging.exists() {
        return Err("宠物库里有一项未完成的同名下载，请稍后再试。".to_string());
    }
    fs::create_dir(&staging).map_err(|error| format!("无法准备下载目录：{error}"))?;

    pet_manifest.id = slug.clone();
    let write_result = write_staged_pet(&staging, &pet_manifest, &installation, &spritesheet_bytes);
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    fs::create_dir_all(&root).map_err(|error| format!("无法创建本地宠物库：{error}"))?;
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        if target.exists() {
            let installed = read_installed_pet(&target)?;
            return validate_installed_identity(installed, provider, &slug);
        }
        return Err(format!("无法把宠物收进本地库：{error}"));
    }

    let installed = read_installed_pet(&target)?;
    validate_installed_identity(installed, provider, &slug)
}

async fn load_manifest(
    app: &AppHandle,
    client: &Client,
    allow_cache: bool,
) -> Result<(CompactManifest, bool), String> {
    let cache_path = manifest_cache_path(app, MANIFEST_CACHE_FILE)?;
    let live_result = async {
        let bytes = download_limited(
            client,
            MANIFEST_URL,
            MAX_MANIFEST_BYTES,
            "Petdex 目录",
            LibraryProvider::Petdex,
        )
        .await?;
        let manifest = parse_manifest(&bytes)?;
        persist_catalog_cache(&cache_path, &bytes, "Petdex");
        Ok::<CompactManifest, String>(manifest)
    }
    .await;

    match live_result {
        Ok(manifest) => Ok((manifest, false)),
        Err(live_error) if allow_cache => {
            let bytes = fs::read(&cache_path)
                .map_err(|_| format!("暂时连不上 Petdex，且本机还没有目录缓存。{live_error}"))?;
            let manifest = parse_manifest(&bytes)
                .map_err(|cache_error| format!("Petdex 目录和本地缓存都不可用：{cache_error}"))?;
            Ok((manifest, true))
        }
        Err(error) => Err(error),
    }
}

async fn load_petshare_manifest(
    app: &AppHandle,
    client: &Client,
    allow_cache: bool,
) -> Result<(PetshareManifest, bool), String> {
    let cache_path = manifest_cache_path(app, PETSHARE_MANIFEST_CACHE_FILE)?;
    let live_result = async {
        let bytes = download_limited(
            client,
            PETSHARE_MANIFEST_URL,
            MAX_PETSHARE_MANIFEST_BYTES,
            "Petshare 目录",
            LibraryProvider::Petshare,
        )
        .await?;
        let manifest = parse_petshare_manifest(&bytes)?;
        petshare_catalog_response(manifest.clone(), false)?;
        persist_catalog_cache(&cache_path, &bytes, "Petshare");
        Ok::<PetshareManifest, String>(manifest)
    }
    .await;

    match live_result {
        Ok(manifest) => Ok((manifest, false)),
        Err(live_error) if allow_cache => {
            let bytes = fs::read(&cache_path)
                .map_err(|_| format!("暂时连不上 Petshare，且本机还没有目录缓存。{live_error}"))?;
            let manifest = parse_petshare_manifest(&bytes)
                .map_err(|cache_error| format!("Petshare 目录和本地缓存都不可用：{cache_error}"))?;
            petshare_catalog_response(manifest.clone(), true)
                .map_err(|cache_error| format!("Petshare 目录和本地缓存都不可用：{cache_error}"))?;
            Ok((manifest, true))
        }
        Err(error) => Err(error),
    }
}

fn persist_catalog_cache(cache_path: &Path, bytes: &[u8], source: &str) {
    if let Err(error) = write_catalog_cache(cache_path, bytes) {
        eprintln!("failed to update the {source} catalog cache: {error}");
    }
}

fn write_catalog_cache(cache_path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic_file(cache_path, bytes, "目录缓存")
}

fn write_atomic_file(path: &Path, bytes: &[u8], label: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| format!("{label}路径无效。"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{label}文件名无效。"))?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建{label}目录：{error}"))?;

    let nonce = now_epoch_nanos()?;
    let temporary = parent.join(format!(".{file_name}-{}-{nonce}.tmp", std::process::id()));
    let backup = parent.join(format!(".{file_name}-{}-{nonce}.bak", std::process::id()));
    fs::write(&temporary, bytes).map_err(|error| format!("无法暂存{label}：{error}"))?;

    if fs::rename(&temporary, path).is_ok() {
        return Ok(());
    }

    if path.exists() && fs::rename(path, &backup).is_ok() {
        match fs::rename(&temporary, path) {
            Ok(()) => {
                let _ = fs::remove_file(&backup);
                return Ok(());
            }
            Err(error) => {
                let _ = fs::rename(&backup, path);
                let _ = fs::remove_file(&temporary);
                return Err(format!("无法替换{label}：{error}"));
            }
        }
    }

    let _ = fs::remove_file(&temporary);
    Err(format!("无法替换{label}。"))
}

fn parse_manifest(bytes: &[u8]) -> Result<CompactManifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Petdex 目录超过安全大小限制。".to_string());
    }
    let manifest: CompactManifest = serde_json::from_slice(bytes)
        .map_err(|error| format!("Petdex 目录格式无法识别：{error}"))?;
    if manifest.v != 2 {
        return Err(format!("暂不支持 Petdex 目录版本 {}。", manifest.v));
    }
    if manifest.asset_base != ASSET_BASE {
        return Err("Petdex 目录使用了未受信任的素材域名。".to_string());
    }
    if manifest.fields != LEGACY_FIELDS && manifest.fields != CURRENT_FIELDS {
        return Err("Petdex 目录字段发生了不兼容变化。".to_string());
    }
    if manifest.total != manifest.pets.len() {
        return Err("Petdex 目录条目数量不一致。".to_string());
    }
    let expected_item_length = manifest.fields.len();
    for item in &manifest.pets {
        validate_compact_item(item, expected_item_length)?;
    }
    Ok(manifest)
}

fn catalog_response(manifest: CompactManifest, stale: bool) -> Result<CatalogResponse, String> {
    let generated_at = manifest.generated_at.clone();
    let total = manifest.total;
    let asset_base = manifest.asset_base;
    let items = manifest
        .pets
        .into_iter()
        .map(|item| compact_item_to_catalog(&asset_base, item))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CatalogResponse {
        generated_at,
        total,
        stale,
        items,
    })
}

fn compact_item_to_catalog(
    asset_base: &str,
    item: model::CompactManifestPet,
) -> Result<CatalogItem, String> {
    validate_compact_item(&item, item.len())?;
    let slug = compact_string(&item, 0, "slug")?;
    let display_name = compact_string(&item, 1, "displayName")?;
    let kind = compact_string(&item, 2, "kind")?;
    let submitted_by = match item.get(3) {
        Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(value)) => Some(value.clone()),
        _ => return Err("Petdex 目录的 submittedBy 字段无效。".to_string()),
    };
    let spritesheet = compact_string(&item, 4, "spritesheet")?;
    let pet_json = compact_string(&item, 5, "petJson")?;
    validate_slug(&slug)?;
    if display_name.trim().is_empty() || display_name.chars().count() > 120 {
        return Err(format!("目录条目 {slug} 的名称无效。"));
    }
    let spritesheet_url = resolve_asset_url(asset_base, &spritesheet)?;
    let pet_json_url = resolve_asset_url(asset_base, &pet_json)?;
    Ok(CatalogItem {
        source_page_url: format!("https://petdex.dev/pets/{slug}"),
        slug,
        display_name,
        description: None,
        kind,
        submitted_by,
        spritesheet_url,
        pet_json_url,
    })
}

fn compact_item_slug(item: &model::CompactManifestPet) -> Option<&str> {
    item.first().and_then(serde_json::Value::as_str)
}

fn compact_string(
    item: &model::CompactManifestPet,
    index: usize,
    field: &str,
) -> Result<String, String> {
    item.get(index)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Petdex 目录的 {field} 字段无效。"))
}

fn validate_compact_item(
    item: &model::CompactManifestPet,
    expected_length: usize,
) -> Result<(), String> {
    if !matches!(expected_length, 7 | 8) || item.len() != expected_length {
        return Err("Petdex 目录条目的字段数量无效。".to_string());
    }
    for index in [0_usize, 1, 2, 4, 5, 6] {
        if item
            .get(index)
            .and_then(serde_json::Value::as_str)
            .is_none()
        {
            return Err("Petdex 目录条目包含无效文本字段。".to_string());
        }
    }
    if !matches!(
        item.get(3),
        Some(serde_json::Value::Null | serde_json::Value::String(_))
    ) {
        return Err("Petdex 目录的 submittedBy 字段无效。".to_string());
    }
    if expected_length == 8
        && !matches!(item.get(7).and_then(serde_json::Value::as_u64), Some(1 | 2))
    {
        return Err("Petdex 目录的 spriteVersionNumber 字段无效。".to_string());
    }
    Ok(())
}

fn parse_petshare_manifest(bytes: &[u8]) -> Result<PetshareManifest, String> {
    if bytes.len() > MAX_PETSHARE_MANIFEST_BYTES {
        return Err("Petshare 目录超过安全大小限制。".to_string());
    }
    serde_json::from_slice(bytes).map_err(|error| format!("Petshare 目录格式无法识别：{error}"))
}

fn petshare_catalog_response(
    manifest: PetshareManifest,
    stale: bool,
) -> Result<CatalogResponse, String> {
    let mut ids = HashSet::with_capacity(manifest.len());
    for item in &manifest {
        if !ids.insert(item.id.as_str()) {
            return Err(format!("Petshare 目录包含重复 id：{}。", item.id));
        }
    }
    let items = manifest
        .into_iter()
        .map(petshare_item_to_catalog)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CatalogResponse {
        generated_at: String::new(),
        total: items.len(),
        stale,
        items,
    })
}

fn petshare_item_to_catalog(item: PetshareCatalogEntry) -> Result<CatalogItem, String> {
    validate_slug(&item.id)?;
    if item.display_name.trim().is_empty() || item.display_name.chars().count() > 120 {
        return Err(format!("Petshare 目录条目 {} 的名称无效。", item.id));
    }
    if item.description.chars().count() > 1_000 {
        return Err(format!("Petshare 目录条目 {} 的描述过长。", item.id));
    }
    if item.sprite_version_number != 2 {
        return Err(format!("Petshare 目录条目 {} 不是 Pet V2。", item.id));
    }
    let expected_spritesheet = format!("/pets/{}/spritesheet.webp", item.id);
    let expected_manifest = format!("/pets/{}/pet.json", item.id);
    let expected_download = format!("/downloads/{}.zip", item.id);
    if item.spritesheet_path != expected_spritesheet
        || item.manifest_path != expected_manifest
        || item.download_path != expected_download
    {
        return Err(format!("Petshare 目录条目 {} 的素材路径无效。", item.id));
    }

    Ok(CatalogItem {
        slug: item.id,
        display_name: item.display_name,
        description: Some(item.description),
        kind: "character".to_string(),
        submitted_by: None,
        spritesheet_url: format!("{PETSHARE_BASE}{expected_spritesheet}"),
        pet_json_url: format!("{PETSHARE_BASE}{expected_manifest}"),
        source_page_url: format!("{PETSHARE_BASE}/"),
    })
}

fn resolve_asset_url(asset_base: &str, reference: &str) -> Result<String, String> {
    let url = if reference.starts_with("https://") {
        reference.to_string()
    } else {
        if reference.starts_with('/')
            || reference
                .split('/')
                .any(|segment| segment == ".." || segment.is_empty())
        {
            return Err("Petdex 目录包含不安全的素材路径。".to_string());
        }
        format!("{asset_base}/{reference}")
    };
    validate_asset_url(&url)?;
    Ok(url)
}

fn validate_asset_url(raw: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(raw).map_err(|_| "素材 URL 无法识别。".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(ASSET_HOST)
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("素材 URL 不在 PetX 的受信范围内。".to_string());
    }
    Ok(())
}

fn validate_petshare_asset_url(raw: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(raw).map_err(|_| "Petshare 素材 URL 无法识别。".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(PETSHARE_HOST)
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Petshare 素材 URL 不在 PetX 的受信范围内。".to_string());
    }
    Ok(())
}

async fn download_limited(
    client: &Client,
    url: &str,
    maximum_bytes: usize,
    label: &str,
    provider: LibraryProvider,
) -> Result<Vec<u8>, String> {
    provider.validate_url(url)?;
    let mut response = client
        .get(url)
        .header(header::REFERER, provider.referer())
        .send()
        .await
        .map_err(|error| format!("{label}下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("{label}下载失败（HTTP {}）。", response.status()));
    }
    if let Some(content_length) = response.content_length() {
        if content_length > maximum_bytes as u64 {
            return Err(format!("{label}超过安全大小限制。"));
        }
    }
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .min(maximum_bytes as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("{label}读取失败：{error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > maximum_bytes {
            return Err(format!("{label}超过安全大小限制。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn cache_pet_preview(
    app: &AppHandle,
    client: &Client,
    cache_lock: &AsyncMutex<()>,
    provider: LibraryProvider,
    item: &CatalogItem,
) -> Result<PetdexPreview, String> {
    let (extension, format) = spritesheet_format_for(provider, &item.spritesheet_url)?;
    let root = preview_cache_root(app)?;
    let target = root.join(source_scoped_key(provider.id(), &item.slug));

    {
        let _cache_guard = cache_lock.lock().await;
        if let Some((preview, _)) = cached_preview(provider, &target, extension, item) {
            touch_preview_cache(&target);
            return Ok(preview);
        }
    }

    let bytes = download_limited(
        client,
        &item.spritesheet_url,
        MAX_SPRITESHEET_BYTES,
        "宠物预览",
        provider,
    )
    .await?;
    let (thumbnail, sprite_version_number) = make_preview_thumbnail(&bytes, format)?;
    validate_preview_version(provider, sprite_version_number)?;
    let record = PreviewRecord {
        spritesheet_url: item.spritesheet_url.clone(),
        sprite_version_number,
        sha256: format!("{:x}", Sha256::digest(&bytes)),
    };
    let record_json = serde_json::to_vec_pretty(&record)
        .map_err(|error| format!("无法整理宠物预览记录：{error}"))?;
    let incoming_bytes = (bytes.len() + thumbnail.len() + record_json.len() + 64) as u64;

    let _cache_guard = cache_lock.lock().await;
    if let Some((preview, _)) = cached_preview(provider, &target, extension, item) {
        touch_preview_cache(&target);
        return Ok(preview);
    }

    fs::create_dir_all(&root).map_err(|error| format!("无法创建预览缓存目录：{error}"))?;
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("无法更新旧预览缓存：{error}"))?;
    }
    prune_preview_cache(&root, incoming_bytes)?;

    let staging_root = root.join(".staging");
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)
            .map_err(|error| format!("无法清理未完成的预览缓存：{error}"))?;
    }
    fs::create_dir_all(&staging_root).map_err(|error| format!("无法创建预览缓存目录：{error}"))?;
    let staging = staging_root.join(format!(
        "{}-{}-{}",
        item.slug,
        std::process::id(),
        now_epoch_nanos()?
    ));
    fs::create_dir(&staging).map_err(|error| format!("无法准备预览缓存：{error}"))?;
    let staged_sprite = staging.join(format!("spritesheet.{extension}"));
    let staged_thumbnail = staging.join("thumbnail.png");
    let staged_record = staging.join("preview.json");
    let write_result = (|| {
        fs::write(&staged_sprite, &bytes)
            .map_err(|error| format!("无法缓存宠物预览图集：{error}"))?;
        fs::write(&staged_thumbnail, &thumbnail)
            .map_err(|error| format!("无法缓存宠物预览缩略图：{error}"))?;
        fs::write(&staged_record, &record_json)
            .map_err(|error| format!("无法缓存宠物预览记录：{error}"))?;
        fs::write(staging.join(".last-used"), now_epoch_seconds()?.to_string())
            .map_err(|error| format!("无法记录宠物预览使用时间：{error}"))
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        if let Some((preview, _)) = cached_preview(provider, &target, extension, item) {
            touch_preview_cache(&target);
            return Ok(preview);
        }
        return Err(format!("无法完成宠物预览缓存：{error}"));
    }

    Ok(preview_paths(&target, extension, &record))
}

async fn read_preview_for_install(
    app: &AppHandle,
    cache_lock: &AsyncMutex<()>,
    provider: LibraryProvider,
    item: &CatalogItem,
) -> Result<(Vec<u8>, PreviewRecord), String> {
    let (extension, _) = spritesheet_format_for(provider, &item.spritesheet_url)?;
    let root = preview_cache_root(app)?;
    let target = root.join(source_scoped_key(provider.id(), &item.slug));
    let _cache_guard = cache_lock.lock().await;
    let (preview, record) = cached_preview(provider, &target, extension, item)
        .ok_or_else(|| "预览还没有准备好，请等伙伴形象出现后再收藏。".to_string())?;
    let sprite_path = PathBuf::from(&preview.sprite_path);
    let bytes =
        fs::read(&sprite_path).map_err(|error| format!("无法读取刚刚预览的宠物图集：{error}"))?;
    let actual_sha256 = format!("{:x}", Sha256::digest(&bytes));
    if actual_sha256 != record.sha256 {
        let _ = fs::remove_dir_all(&target);
        return Err("宠物预览缓存校验失败，请重新打开这只伙伴再试。".to_string());
    }
    touch_preview_cache(&target);
    Ok((bytes, record))
}

fn spritesheet_format_for(
    provider: LibraryProvider,
    url: &str,
) -> Result<(&'static str, image::ImageFormat), String> {
    provider.validate_url(url)?;
    let path = reqwest::Url::parse(url)
        .map_err(|_| "宠物预览地址无法识别。".to_string())?
        .path()
        .to_ascii_lowercase();
    if path.ends_with(".webp") {
        Ok(("webp", image::ImageFormat::WebP))
    } else if path.ends_with(".png") {
        Ok(("png", image::ImageFormat::Png))
    } else {
        Err("宠物预览不是受支持的 PNG 或 WebP 图集。".to_string())
    }
}

fn make_preview_thumbnail(
    bytes: &[u8],
    format: image::ImageFormat,
) -> Result<(Vec<u8>, u8), String> {
    let image = decode_spritesheet(bytes, format, "宠物预览")?;
    let dimensions = image.dimensions();
    let sprite_version_number = match dimensions {
        (1536, 1872) => 1,
        (1536, 2288) => 2,
        _ => {
            return Err(format!(
                "宠物预览尺寸为 {}×{}，不是 PetX V1 或 V2 图集。",
                dimensions.0, dimensions.1
            ))
        }
    };
    let thumbnail = image.crop_imm(0, 0, 192, 208);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("无法生成宠物预览缩略图：{error}"))?;
    Ok((output.into_inner(), sprite_version_number))
}

fn validate_preview_version(
    provider: LibraryProvider,
    sprite_version_number: u8,
) -> Result<(), String> {
    if matches!(provider, LibraryProvider::Petshare) && sprite_version_number != 2 {
        return Err("Petshare 预览不是 V2 宠物图集。".to_string());
    }
    Ok(())
}

fn cached_preview(
    provider: LibraryProvider,
    target: &Path,
    extension: &str,
    item: &CatalogItem,
) -> Option<(PetdexPreview, PreviewRecord)> {
    let sprite_path = target.join(format!("spritesheet.{extension}"));
    let thumbnail_path = target.join("thumbnail.png");
    let record: PreviewRecord =
        serde_json::from_slice(&fs::read(target.join("preview.json")).ok()?).ok()?;
    if record.spritesheet_url != item.spritesheet_url
        || !matches!(record.sprite_version_number, 1 | 2)
        || record.sha256.len() != 64
        || validate_preview_version(provider, record.sprite_version_number).is_err()
    {
        return None;
    }
    let valid_size = |path: &Path, maximum: u64| {
        fs::metadata(path)
            .map(|metadata| metadata.is_file() && metadata.len() > 0 && metadata.len() <= maximum)
            .unwrap_or(false)
    };
    if !valid_size(&sprite_path, MAX_SPRITESHEET_BYTES as u64)
        || !valid_size(&thumbnail_path, MAX_THUMBNAIL_BYTES)
    {
        return None;
    }
    Some((preview_paths(target, extension, &record), record))
}

fn preview_paths(target: &Path, extension: &str, record: &PreviewRecord) -> PetdexPreview {
    PetdexPreview {
        sprite_path: target
            .join(format!("spritesheet.{extension}"))
            .to_string_lossy()
            .into_owned(),
        thumbnail_path: target.join("thumbnail.png").to_string_lossy().into_owned(),
        sprite_version_number: record.sprite_version_number,
        sha256: record.sha256.clone(),
    }
}

fn touch_preview_cache(target: &Path) {
    let _ = fs::write(
        target.join(".last-used"),
        now_epoch_seconds().unwrap_or_default().to_string(),
    );
}

fn prune_preview_cache(root: &Path, incoming_bytes: u64) -> Result<(), String> {
    if incoming_bytes > MAX_PREVIEW_CACHE_BYTES {
        return Err("单个宠物预览超过本地缓存上限。".to_string());
    }
    let mut entries = Vec::new();
    let mut total_bytes = 0_u64;
    for entry in fs::read_dir(root).map_err(|error| format!("无法检查预览缓存：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法检查预览缓存条目：{error}"))?;
        let path = entry.path();
        if !path.is_dir() || entry.file_name() == ".staging" {
            continue;
        }
        let size = preview_directory_size(&path)?;
        let last_used = fs::metadata(path.join(".last-used"))
            .and_then(|metadata| metadata.modified())
            .or_else(|_| fs::metadata(&path).and_then(|metadata| metadata.modified()))
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        total_bytes = total_bytes.saturating_add(size);
        entries.push((path, size, last_used));
    }
    entries.sort_by_key(|entry| entry.2);

    while (total_bytes.saturating_add(incoming_bytes) > MAX_PREVIEW_CACHE_BYTES
        || entries.len().saturating_add(1) > MAX_PREVIEW_CACHE_ENTRIES)
        && !entries.is_empty()
    {
        let (path, size, _) = entries.remove(0);
        fs::remove_dir_all(&path)
            .map_err(|error| format!("无法淘汰旧预览缓存 {}：{error}", path.display()))?;
        total_bytes = total_bytes.saturating_sub(size);
    }
    if total_bytes.saturating_add(incoming_bytes) > MAX_PREVIEW_CACHE_BYTES
        || entries.len().saturating_add(1) > MAX_PREVIEW_CACHE_ENTRIES
    {
        return Err("本地预览缓存已满，且无法安全释放旧条目。".to_string());
    }
    Ok(())
}

fn preview_directory_size(directory: &Path) -> Result<u64, String> {
    let mut size = 0_u64;
    for entry in
        fs::read_dir(directory).map_err(|error| format!("无法检查预览缓存大小：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法检查预览缓存文件：{error}"))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("无法读取预览缓存文件信息：{error}"))?;
        if metadata.is_file() {
            size = size.saturating_add(metadata.len());
        }
    }
    Ok(size)
}

fn validate_pet_manifest(manifest: &PetManifest) -> Result<(), String> {
    if manifest.id.trim().is_empty() || manifest.id.chars().count() > 80 {
        return Err("宠物清单的 id 无效。".to_string());
    }
    if manifest.display_name.trim().is_empty() || manifest.display_name.chars().count() > 120 {
        return Err("宠物清单的显示名称无效。".to_string());
    }
    if let Some(description) = &manifest.description {
        if description.chars().count() > 1_000 {
            return Err("宠物清单的描述过长。".to_string());
        }
    }
    if !matches!(manifest.sprite_version_number, None | Some(1) | Some(2)) {
        return Err("PetX 只支持 V1 或 V2 宠物图集。".to_string());
    }
    if !matches!(
        manifest.spritesheet_path.as_str(),
        "spritesheet.webp" | "spritesheet.png"
    ) {
        return Err("宠物清单只能引用同目录的 spritesheet.webp 或 spritesheet.png。".to_string());
    }
    Ok(())
}

fn validate_petshare_pet_manifest(
    slug: &str,
    manifest: &PetManifest,
    catalog_item: &CatalogItem,
) -> Result<(), String> {
    validate_pet_manifest(manifest)?;
    if manifest.id != slug {
        return Err("Petshare 宠物清单与目录 id 不一致。".to_string());
    }
    if manifest.display_name != catalog_item.display_name
        || manifest.description != catalog_item.description
    {
        return Err("Petshare 宠物清单与目录展示信息不一致。".to_string());
    }
    if manifest.sprite_version_number != Some(2) || manifest.spritesheet_path != "spritesheet.webp"
    {
        return Err("Petshare 只支持 V2 WebP 宠物图集。".to_string());
    }
    Ok(())
}

fn validate_spritesheet(bytes: &[u8], manifest: &PetManifest) -> Result<(), String> {
    let format = match manifest.spritesheet_path.as_str() {
        "spritesheet.webp" => image::ImageFormat::WebP,
        "spritesheet.png" => image::ImageFormat::Png,
        _ => return Err("宠物图集文件类型不受支持。".to_string()),
    };
    let image = decode_spritesheet(bytes, format, "宠物图集")?;
    let actual = image.dimensions();
    let expected = expected_dimensions(manifest.sprite_version_number);
    if actual != expected {
        return Err(format!(
            "宠物图集尺寸为 {}×{}，当前版本需要 {}×{}。",
            actual.0, actual.1, expected.0, expected.1
        ));
    }
    Ok(())
}

fn decode_spritesheet(
    bytes: &[u8],
    format: image::ImageFormat,
    label: &str,
) -> Result<image::DynamicImage, String> {
    let mut limits = Limits::default();
    limits.max_image_width = Some(1536);
    limits.max_image_height = Some(2288);
    limits.max_alloc = Some(MAX_DECODE_ALLOCATION_BYTES);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|error| format!("{label}无法在安全内存限制内解码：{error}"))
}

fn expected_dimensions(sprite_version_number: Option<u8>) -> (u32, u32) {
    if sprite_version_number == Some(2) {
        (1536, 2288)
    } else {
        (1536, 1872)
    }
}

fn write_staged_pet(
    staging: &Path,
    manifest: &PetManifest,
    installation: &InstallationRecord,
    spritesheet: &[u8],
) -> Result<(), String> {
    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("无法整理宠物清单：{error}"))?;
    let installation_json = serde_json::to_vec_pretty(installation)
        .map_err(|error| format!("无法记录宠物来源：{error}"))?;
    fs::write(staging.join("pet.json"), manifest_json)
        .map_err(|error| format!("无法写入宠物清单：{error}"))?;
    fs::write(staging.join(&manifest.spritesheet_path), spritesheet)
        .map_err(|error| format!("无法写入宠物图集：{error}"))?;
    fs::write(staging.join("installation.json"), installation_json)
        .map_err(|error| format!("无法写入宠物来源记录：{error}"))?;
    Ok(())
}

fn existing_installed_pet(
    app: &AppHandle,
    provider: LibraryProvider,
    slug: &str,
) -> Result<Option<InstalledPet>, String> {
    let root = pets_root(app)?;
    let target = root.join(source_scoped_key(provider.id(), slug));
    if target.exists() {
        let installed = read_installed_pet(&target)?;
        return validate_installed_identity(installed, provider, slug).map(Some);
    }

    if matches!(provider, LibraryProvider::Petdex) {
        let legacy_target = root.join(slug);
        if legacy_target.exists() {
            if let Ok(installed) = read_installed_pet(&legacy_target) {
                if installed.source == provider.id() && installed.slug == slug {
                    return Ok(Some(installed));
                }
            }
        }
    }

    Ok(None)
}

fn validate_installed_identity(
    installed: InstalledPet,
    provider: LibraryProvider,
    slug: &str,
) -> Result<InstalledPet, String> {
    if installed.source != provider.id() || installed.slug != slug {
        return Err("本地宠物来源记录与安装目录不一致。".to_string());
    }
    Ok(installed)
}

fn read_installed_pet(directory: &Path) -> Result<InstalledPet, String> {
    let manifest_path = directory.join("pet.json");
    let installation_path = directory.join("installation.json");
    let manifest: PetManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("无法读取 {}：{error}", manifest_path.display()))?,
    )
    .map_err(|error| format!("本地宠物清单无效：{error}"))?;
    validate_pet_manifest(&manifest)?;
    let installation: InstallationRecord = serde_json::from_slice(
        &fs::read(&installation_path)
            .map_err(|error| format!("无法读取 {}：{error}", installation_path.display()))?,
    )
    .map_err(|error| format!("本地来源记录无效：{error}"))?;
    if !matches!(
        installation.source.as_str(),
        "petdex" | "petshare" | "imported"
    ) || validate_slug(&installation.remote_id).is_err()
        || manifest.id != installation.remote_id
    {
        return Err("本地宠物清单、来源记录与安装目录不一致。".to_string());
    }
    let sprite_path = directory.join(&manifest.spritesheet_path);
    if !sprite_path.is_file() {
        return Err("本地宠物图集已经丢失。".to_string());
    }
    Ok(InstalledPet {
        source: installation.source,
        slug: installation.remote_id,
        display_name: manifest.display_name,
        description: manifest.description,
        submitted_by: installation.submitted_by,
        sprite_path: sprite_path.to_string_lossy().into_owned(),
        source_page_url: installation.source_page_url,
        sprite_version_number: manifest.sprite_version_number.unwrap_or(1),
        installed_at_epoch_seconds: installation.installed_at_epoch_seconds,
        last_used_at_epoch_seconds: installation.last_used_at_epoch_seconds,
        use_count: installation.use_count,
        sha256: installation.sha256,
    })
}

pub(super) fn record_installed_pet_usage(
    data_root: &Path,
    source: &str,
    slug: &str,
) -> Result<(), String> {
    validate_slug(slug)?;
    let root = data_root.join("pets");
    let scoped = root.join(source_scoped_key(source, slug));
    let directory = if scoped.is_dir() {
        scoped
    } else if source == "petdex" && root.join(slug).is_dir() {
        root.join(slug)
    } else {
        return Err("无法在本地宠物库里记录这次陪伴。".to_string());
    };
    let installation_path = directory.join("installation.json");
    let bytes =
        read_limited_local_file(&installation_path, MAX_PET_JSON_BYTES, "本地宠物来源记录")?;
    let mut installation: InstallationRecord =
        serde_json::from_slice(&bytes).map_err(|error| format!("本地来源记录无效：{error}"))?;
    if installation.source != source || installation.remote_id != slug {
        return Err("本地宠物来源记录与所选身份不一致。".to_string());
    }
    installation.last_used_at_epoch_seconds = Some(now_epoch_seconds()?);
    installation.use_count = installation.use_count.saturating_add(1);
    let updated = serde_json::to_vec_pretty(&installation)
        .map_err(|error| format!("无法整理宠物使用历史：{error}"))?;
    write_atomic_file(&installation_path, &updated, "宠物使用历史")
}

fn read_limited_local_file(path: &Path, maximum: usize, label: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取{label} {}：{error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum as u64 {
        return Err(format!("{label}不存在、为空或超过安全大小限制。"));
    }
    fs::read(path).map_err(|error| format!("无法读取{label} {}：{error}", path.display()))
}

fn pets_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("pets"))
        .map_err(|error| format!("无法定位 PetX 本地宠物库：{error}"))
}

fn manifest_cache_path(app: &AppHandle, cache_file: &str) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join(cache_file))
        .map_err(|error| format!("无法定位 PetX 目录缓存：{error}"))
}

fn preview_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join(PREVIEW_CACHE_DIRECTORY))
        .map_err(|error| format!("无法定位 PetX 预览缓存：{error}"))
}

fn now_epoch_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "系统时间无效，无法记录下载。".to_string())
}

fn now_epoch_nanos() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|_| "系统时间无效，无法缓存预览。".to_string())
}

fn validate_slug(slug: &str) -> Result<(), String> {
    let bytes = slug.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 80
        || !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
    {
        return Err("宠物目录 id 不是安全的 slug。".to_string());
    }
    Ok(())
}

fn source_scoped_key(source: &str, slug: &str) -> String {
    format!("{source}--{slug}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_petdex_v2_manifest_accepts_sprite_version_field() {
        let bytes = br#"{
          "v": 2,
          "generatedAt": "2026-08-09T12:33:27.295Z",
          "total": 1,
          "assetBase": "https://assets.petdex.dev",
          "fields": [
            "slug", "displayName", "kind", "submittedBy",
            "spritesheet", "petJson", "zip", "spriteVersionNumber"
          ],
          "pets": [[
            "homelander", "Homelander", "character", "Serhat",
            "pets/homelander-dbbb6a60a484/sprite.webp",
            "pets/homelander-dbbb6a60a484/petjson.json",
            "pets/homelander-dbbb6a60a484/zip.zip", 1
          ]]
        }"#;

        let response = catalog_response(parse_manifest(bytes).unwrap(), false).unwrap();

        assert_eq!(response.total, 1);
        assert_eq!(response.items[0].slug, "homelander");
        assert_eq!(response.items[0].display_name, "Homelander");
    }

    #[test]
    fn imports_a_valid_local_package_into_catalog_independent_history() {
        let root = std::env::temp_dir().join(format!(
            "petx-local-import-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ));
        let package = root.join("downloaded-package");
        let data_root = root.join("app-data");
        fs::create_dir_all(&package).unwrap();
        let image = image::DynamicImage::new_rgba8(1536, 1872);
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        fs::write(package.join("spritesheet.png"), encoded.into_inner()).unwrap();
        fs::write(
            package.join("pet.json"),
            br#"{
              "id": "downloaded-friend",
              "displayName": "Downloaded Friend",
              "description": "A package the user downloaded themselves.",
              "spriteVersionNumber": 1,
              "spritesheetPath": "spritesheet.png"
            }"#,
        )
        .unwrap();

        let imported = import_local_pet_at(&data_root, &package.join("pet.json")).unwrap();
        let history = list_installed_pets_at(&data_root.join("pets")).unwrap();

        assert_eq!(imported.source, "imported");
        assert!(imported.slug.starts_with("local-"));
        assert_eq!(imported.display_name, "Downloaded Friend");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].slug, imported.slug);
        assert_eq!(history[0].last_used_at_epoch_seconds, None);
        assert_eq!(history[0].use_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_safe_petdex_asset_urls() {
        assert!(validate_asset_url("https://assets.petdex.dev/pets/example/sprite.webp").is_ok());
    }

    #[test]
    fn rejects_untrusted_or_ambiguous_asset_urls() {
        for url in [
            "http://assets.petdex.dev/pets/example/sprite.webp",
            "https://evil.example/pets/example/sprite.webp",
            "https://assets.petdex.dev.evil.example/sprite.webp",
            "https://assets.petdex.dev/pets/example/sprite.webp?raw=1",
            "https://user@assets.petdex.dev/pets/example/sprite.webp",
        ] {
            assert!(validate_asset_url(url).is_err(), "{url} should fail");
        }
    }

    #[test]
    fn validates_storage_slugs() {
        assert!(validate_slug("mecha-xiaobai").is_ok());
        assert!(validate_slug("2-sankarea").is_ok());
        for slug in ["", "../pet", "Pet", "-pet", "pet_name", "宠物"] {
            assert!(validate_slug(slug).is_err(), "{slug} should fail");
        }
    }

    #[test]
    fn maps_sprite_versions_to_exact_dimensions() {
        assert_eq!(expected_dimensions(None), (1536, 1872));
        assert_eq!(expected_dimensions(Some(1)), (1536, 1872));
        assert_eq!(expected_dimensions(Some(2)), (1536, 2288));
    }

    #[test]
    fn accepts_only_supported_preview_extensions() {
        assert_eq!(
            spritesheet_format_for(
                LibraryProvider::Petdex,
                "https://assets.petdex.dev/pets/example/sprite.webp"
            )
            .unwrap()
            .0,
            "webp"
        );
        assert_eq!(
            spritesheet_format_for(
                LibraryProvider::Petdex,
                "https://assets.petdex.dev/pets/example/sprite.png"
            )
            .unwrap()
            .0,
            "png"
        );
        assert!(spritesheet_format_for(
            LibraryProvider::Petdex,
            "https://assets.petdex.dev/pets/example/sprite.svg"
        )
        .is_err());
    }

    #[test]
    fn rejects_images_above_petx_dimensions_before_rendering() {
        let image = image::DynamicImage::new_rgba8(1537, 1);
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        assert!(
            decode_spritesheet(&encoded.into_inner(), image::ImageFormat::Png, "test").is_err()
        );
    }

    #[test]
    fn preview_cache_is_bounded_by_entry_count() {
        let root = std::env::temp_dir().join(format!(
            "petx-preview-prune-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        for index in 0..MAX_PREVIEW_CACHE_ENTRIES {
            let directory = root.join(format!("pet-{index}"));
            fs::create_dir(&directory).unwrap();
            fs::write(directory.join("thumbnail.png"), [index as u8]).unwrap();
        }

        prune_preview_cache(&root, 1).unwrap();
        let remaining = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .count();
        assert_eq!(remaining, MAX_PREVIEW_CACHE_ENTRIES - 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_cache_is_bound_to_the_catalog_asset_url() {
        let target = std::env::temp_dir().join(format!(
            "petx-preview-binding-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ));
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("spritesheet.webp"), [1_u8]).unwrap();
        fs::write(target.join("thumbnail.png"), [1_u8]).unwrap();
        let original_url = "https://assets.petdex.dev/pets/example/sprite.webp";
        let record = PreviewRecord {
            spritesheet_url: original_url.to_string(),
            sprite_version_number: 2,
            sha256: "a".repeat(64),
        };
        fs::write(
            target.join("preview.json"),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        let mut item = CatalogItem {
            slug: "example".to_string(),
            display_name: "Example".to_string(),
            description: None,
            kind: "character".to_string(),
            submitted_by: None,
            spritesheet_url: original_url.to_string(),
            pet_json_url: "https://assets.petdex.dev/pets/example/pet.json".to_string(),
            source_page_url: "https://petdex.dev/pets/example".to_string(),
        };

        assert!(cached_preview(LibraryProvider::Petdex, &target, "webp", &item).is_some());
        item.spritesheet_url = "https://assets.petdex.dev/pets/example/new-sprite.webp".to_string();
        assert!(cached_preview(LibraryProvider::Petdex, &target, "webp", &item).is_none());
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn petshare_preview_cache_rejects_legacy_sprite_geometry() {
        let target = std::env::temp_dir().join(format!(
            "petx-petshare-preview-version-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ));
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("spritesheet.webp"), [1_u8]).unwrap();
        fs::write(target.join("thumbnail.png"), [1_u8]).unwrap();
        let spritesheet_url =
            "https://petshare.idevlab.dev/pets/example/spritesheet.webp".to_string();
        let record = PreviewRecord {
            spritesheet_url: spritesheet_url.clone(),
            sprite_version_number: 1,
            sha256: "a".repeat(64),
        };
        fs::write(
            target.join("preview.json"),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        let item = CatalogItem {
            slug: "example".to_string(),
            display_name: "Example".to_string(),
            description: None,
            kind: "character".to_string(),
            submitted_by: None,
            spritesheet_url,
            pet_json_url: "https://petshare.idevlab.dev/pets/example/pet.json".to_string(),
            source_page_url: "https://petshare.idevlab.dev/".to_string(),
        };

        assert!(
            cached_preview(LibraryProvider::Petshare, &target, "webp", &item).is_none(),
            "Petshare must never reuse a legacy V1 preview cache"
        );
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn petshare_catalog_maps_public_entries_to_trusted_assets() {
        let bytes = br#"[
          {
            "id": "bill-gates",
            "displayName": "Bill Gates",
            "description": "A tiny coding companion.",
            "spriteVersionNumber": 2,
            "spritesheetPath": "/pets/bill-gates/spritesheet.webp",
            "manifestPath": "/pets/bill-gates/pet.json",
            "downloadPath": "/downloads/bill-gates.zip"
          }
        ]"#;

        let response = petshare_catalog_response(parse_petshare_manifest(bytes).unwrap(), false)
            .expect("valid Petshare entries should map to the public catalog");

        assert_eq!(response.total, 1);
        assert!(!response.stale);
        assert_eq!(response.items[0].slug, "bill-gates");
        assert_eq!(response.items[0].display_name, "Bill Gates");
        assert_eq!(response.items[0].kind, "character");
        assert_eq!(
            response.items[0].spritesheet_url,
            "https://petshare.idevlab.dev/pets/bill-gates/spritesheet.webp"
        );
        assert_eq!(
            response.items[0].pet_json_url,
            "https://petshare.idevlab.dev/pets/bill-gates/pet.json"
        );
    }

    #[test]
    fn petshare_catalog_rejects_duplicate_ids() {
        let bytes = br#"[
          {
            "id": "same-pet",
            "displayName": "First",
            "description": "First entry.",
            "spriteVersionNumber": 2,
            "spritesheetPath": "/pets/same-pet/spritesheet.webp",
            "manifestPath": "/pets/same-pet/pet.json",
            "downloadPath": "/downloads/same-pet.zip"
          },
          {
            "id": "same-pet",
            "displayName": "Second",
            "description": "Second entry.",
            "spriteVersionNumber": 2,
            "spritesheetPath": "/pets/same-pet/spritesheet.webp",
            "manifestPath": "/pets/same-pet/pet.json",
            "downloadPath": "/downloads/same-pet.zip"
          }
        ]"#;

        let result = petshare_catalog_response(parse_petshare_manifest(bytes).unwrap(), false);

        assert!(result.is_err());
    }

    #[test]
    fn petshare_catalog_tolerates_future_metadata_fields() {
        let bytes = br#"[
          {
            "id": "future-pet",
            "displayName": "Future Pet",
            "description": "Still compatible when the source adds metadata.",
            "spriteVersionNumber": 2,
            "spritesheetPath": "/pets/future-pet/spritesheet.webp",
            "manifestPath": "/pets/future-pet/pet.json",
            "downloadPath": "/downloads/future-pet.zip",
            "license": "CC-BY-4.0"
          }
        ]"#;

        let response = petshare_catalog_response(parse_petshare_manifest(bytes).unwrap(), false)
            .expect("unrelated future fields should not break the catalog");

        assert_eq!(response.items[0].slug, "future-pet");
    }

    #[test]
    fn petshare_assets_require_the_exact_public_origin() {
        assert!(validate_petshare_asset_url(
            "https://petshare.idevlab.dev/pets/example/spritesheet.webp"
        )
        .is_ok());
        for url in [
            "http://petshare.idevlab.dev/pets/example/spritesheet.webp",
            "https://evil.example/pets/example/spritesheet.webp",
            "https://petshare.idevlab.dev.evil.example/pets/example/spritesheet.webp",
            "https://petshare.idevlab.dev:444/pets/example/spritesheet.webp",
            "https://user@petshare.idevlab.dev/pets/example/spritesheet.webp",
            "https://petshare.idevlab.dev/pets/example/spritesheet.webp?raw=1",
        ] {
            assert!(
                validate_petshare_asset_url(url).is_err(),
                "{url} should fail"
            );
        }
    }

    #[test]
    fn storage_keys_keep_same_slug_sources_separate() {
        assert_eq!(source_scoped_key("petdex", "same-pet"), "petdex--same-pet");
        assert_eq!(
            source_scoped_key("petshare", "same-pet"),
            "petshare--same-pet"
        );
        assert_ne!(
            source_scoped_key("petdex", "same-pet"),
            source_scoped_key("petshare", "same-pet")
        );
    }

    #[test]
    fn catalog_cache_replacement_never_exposes_a_partial_write() {
        let root = std::env::temp_dir().join(format!(
            "petx-catalog-cache-{}-{}",
            std::process::id(),
            now_epoch_nanos().unwrap()
        ));
        let cache = root.join("catalog.json");

        write_catalog_cache(&cache, br#"{"version":1}"#).unwrap();
        write_catalog_cache(&cache, br#"{"version":2}"#).unwrap();

        assert_eq!(fs::read(&cache).unwrap(), br#"{"version":2}"#);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_pet_serializes_its_source() {
        let installed = InstalledPet {
            source: "petshare".to_string(),
            slug: "same-pet".to_string(),
            display_name: "Same Pet".to_string(),
            description: None,
            submitted_by: None,
            sprite_path: "/tmp/same-pet/spritesheet.webp".to_string(),
            source_page_url: "https://petshare.idevlab.dev/".to_string(),
            sprite_version_number: 2,
            installed_at_epoch_seconds: 1,
            last_used_at_epoch_seconds: None,
            use_count: 0,
            sha256: "a".repeat(64),
        };

        let json = serde_json::to_value(installed).unwrap();

        assert_eq!(json["source"], "petshare");
        assert_eq!(json["slug"], "same-pet");
    }

    #[test]
    fn petshare_install_manifest_must_match_the_catalog_identity() {
        let catalog_item = CatalogItem {
            slug: "same-pet".to_string(),
            display_name: "Same Pet".to_string(),
            description: Some("Same description.".to_string()),
            kind: "character".to_string(),
            submitted_by: None,
            spritesheet_url: "https://petshare.idevlab.dev/pets/same-pet/spritesheet.webp"
                .to_string(),
            pet_json_url: "https://petshare.idevlab.dev/pets/same-pet/pet.json".to_string(),
            source_page_url: "https://petshare.idevlab.dev/".to_string(),
        };
        let valid = PetManifest {
            id: "same-pet".to_string(),
            display_name: "Same Pet".to_string(),
            description: Some("Same description.".to_string()),
            sprite_version_number: Some(2),
            spritesheet_path: "spritesheet.webp".to_string(),
        };
        assert!(validate_petshare_pet_manifest("same-pet", &valid, &catalog_item).is_ok());

        let mut mismatched = valid.clone();
        mismatched.id = "another-pet".to_string();
        assert!(validate_petshare_pet_manifest("same-pet", &mismatched, &catalog_item).is_err());

        let mut renamed = valid.clone();
        renamed.display_name = "Another Pet".to_string();
        assert!(validate_petshare_pet_manifest("same-pet", &renamed, &catalog_item).is_err());

        let mut redescribed = valid.clone();
        redescribed.description = Some("Another description.".to_string());
        assert!(validate_petshare_pet_manifest("same-pet", &redescribed, &catalog_item).is_err());

        let mut legacy = valid.clone();
        legacy.sprite_version_number = Some(1);
        assert!(validate_petshare_pet_manifest("same-pet", &legacy, &catalog_item).is_err());

        let mut png = valid;
        png.spritesheet_path = "spritesheet.png".to_string();
        assert!(validate_petshare_pet_manifest("same-pet", &png, &catalog_item).is_err());
    }

    #[test]
    fn petshare_preview_rejects_legacy_sprite_geometry() {
        assert!(validate_preview_version(LibraryProvider::Petshare, 2).is_ok());
        assert!(validate_preview_version(LibraryProvider::Petshare, 1).is_err());
        assert!(validate_preview_version(LibraryProvider::Petdex, 1).is_ok());
        assert!(validate_preview_version(LibraryProvider::Petdex, 2).is_ok());
    }
}
