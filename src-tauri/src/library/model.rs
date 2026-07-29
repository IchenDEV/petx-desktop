use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivePetSource {
    Petdex,
    Petshare,
}

impl ActivePetSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Petdex => "petdex",
            Self::Petshare => "petshare",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ActivePetRef {
    Builtin {
        id: String,
    },
    Installed {
        source: ActivePetSource,
        slug: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedActivePet {
    pub reference: ActivePetRef,
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub sprite_version_number: u8,
    pub sprite_path: Option<String>,
    pub manifest_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub slug: String,
    pub display_name: String,
    pub description: Option<String>,
    pub kind: String,
    pub submitted_by: Option<String>,
    pub spritesheet_url: String,
    pub pet_json_url: String,
    pub source_page_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub generated_at: String,
    pub total: usize,
    pub stale: bool,
    pub items: Vec<CatalogItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPet {
    pub source: String,
    pub slug: String,
    pub display_name: String,
    pub description: Option<String>,
    pub submitted_by: Option<String>,
    pub sprite_path: String,
    pub source_page_url: String,
    pub sprite_version_number: u8,
    pub installed_at_epoch_seconds: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetdexPreview {
    pub sprite_path: String,
    pub thumbnail_path: String,
    pub sprite_version_number: u8,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite_version_number: Option<u8>,
    pub spritesheet_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CompactManifest {
    pub v: u8,
    pub generated_at: String,
    pub total: usize,
    pub asset_base: String,
    pub fields: Vec<String>,
    pub pets: Vec<CompactManifestPet>,
}

pub(super) type CompactManifestPet = (
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    Option<String>,
);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PetshareCatalogEntry {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub sprite_version_number: u8,
    pub spritesheet_path: String,
    pub manifest_path: String,
    pub download_path: String,
}

pub(super) type PetshareManifest = Vec<PetshareCatalogEntry>;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstallationRecord {
    pub source: String,
    pub remote_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub submitted_by: Option<String>,
    pub source_page_url: String,
    pub manifest_generated_at: String,
    pub installed_at_epoch_seconds: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewRecord {
    pub spritesheet_url: String,
    pub sprite_version_number: u8,
    pub sha256: String,
}
