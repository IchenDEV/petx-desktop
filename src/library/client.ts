import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '../platform';
import type {
  CatalogItem,
  CatalogResponse,
  InstalledPet,
} from './model';

const PREVIEW_MANIFEST_URL = '/__petdex/manifest';
const PETDEX_ASSET_BASE = 'https://assets.petdex.dev';
const previewRequests = new Map<string, Promise<ResolvedPetPreview>>();

interface CachedPetdexPreview {
  spritePath: string;
  thumbnailPath: string;
  spriteVersionNumber: number;
  sha256: string;
}

export interface ResolvedPetPreview {
  spriteUrl: string;
  thumbnailUrl: string;
  thumbnailIsSheet: boolean;
  spriteVersionNumber: number;
  sha256?: string;
}

export async function fetchPetdexCatalog(): Promise<CatalogResponse> {
  if (isTauri) return invoke<CatalogResponse>('get_petdex_catalog');

  const response = await fetch(PREVIEW_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`预览目录请求失败（HTTP ${response.status}）。`);
  }
  return parseCompactManifest(await response.json());
}

export async function fetchInstalledPets(): Promise<InstalledPet[]> {
  if (!isTauri) return [];
  return invoke<InstalledPet[]>('list_installed_pets');
}

export async function installPetdexPet(slug: string): Promise<InstalledPet> {
  if (!isTauri) {
    throw new Error('请在 PetX 桌面版里把伙伴收进本地宠物库。');
  }
  return invoke<InstalledPet>('install_petdex_pet', { slug });
}

export function fetchPetdexPreview(
  slug: string,
  spritesheetUrl: string,
  petJsonUrl: string,
): Promise<ResolvedPetPreview> {
  const cacheKey = `${slug}|${spritesheetUrl}|${petJsonUrl}`;
  const existing = previewRequests.get(cacheKey);
  if (existing) return existing;

  const request = resolvePetdexPreview(
    slug,
    spritesheetUrl,
    petJsonUrl,
  ).catch((error) => {
    previewRequests.delete(cacheKey);
    throw error;
  });
  previewRequests.set(cacheKey, request);
  return request;
}

export function installedSpriteUrl(pet: InstalledPet): string {
  return isTauri ? convertFileSrc(pet.spritePath) : pet.spritePath;
}

export async function openExternalPage(url: string): Promise<void> {
  if (isTauri) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function resolvePetdexPreview(
  slug: string,
  spritesheetUrl: string,
  petJsonUrl: string,
): Promise<ResolvedPetPreview> {
  if (isTauri) {
    const cached = await invoke<CachedPetdexPreview>('get_petdex_preview', {
      slug,
    });
    return {
      spriteUrl: convertFileSrc(cached.spritePath),
      thumbnailUrl: convertFileSrc(cached.thumbnailPath),
      thumbnailIsSheet: false,
      spriteVersionNumber: cached.spriteVersionNumber,
      sha256: cached.sha256,
    };
  }

  const trustedUrl = new URL(resolvePetdexAsset(spritesheetUrl));
  const trustedManifestUrl = new URL(resolvePetdexAsset(petJsonUrl));
  const proxiedUrl = `/__petdex/assets${trustedUrl.pathname}`;
  const manifestResponse = await fetch(
    `/__petdex/assets${trustedManifestUrl.pathname}`,
  );
  if (!manifestResponse.ok) {
    throw new Error(`宠物预览清单请求失败（HTTP ${manifestResponse.status}）。`);
  }
  const manifest = await manifestResponse.json();
  const spriteVersionNumber =
    isRecord(manifest) && manifest.spriteVersionNumber === 2 ? 2 : 1;
  return {
    spriteUrl: proxiedUrl,
    thumbnailUrl: proxiedUrl,
    thumbnailIsSheet: true,
    spriteVersionNumber,
  };
}

function parseCompactManifest(value: unknown): CatalogResponse {
  if (!isRecord(value) || value.v !== 2) {
    throw new Error('Petdex 预览目录版本无法识别。');
  }
  if (
    value.assetBase !== PETDEX_ASSET_BASE ||
    typeof value.generatedAt !== 'string' ||
    typeof value.total !== 'number' ||
    !Array.isArray(value.pets)
  ) {
    throw new Error('Petdex 预览目录字段不完整。');
  }

  const items = value.pets.map(parseCompactItem);
  if (items.length !== value.total) {
    throw new Error('Petdex 预览目录条目数量不一致。');
  }
  return {
    generatedAt: value.generatedAt,
    total: value.total,
    stale: false,
    items,
  };
}

function parseCompactItem(value: unknown): CatalogItem {
  if (
    !Array.isArray(value) ||
    value.length !== 7 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string' ||
    typeof value[2] !== 'string' ||
    (value[3] !== null && typeof value[3] !== 'string') ||
    typeof value[4] !== 'string' ||
    typeof value[5] !== 'string'
  ) {
    throw new Error('Petdex 预览目录中有无法识别的条目。');
  }
  const slug = value[0];
  return {
    slug,
    displayName: value[1],
    kind: value[2],
    submittedBy: value[3],
    spritesheetUrl: resolvePetdexAsset(value[4]),
    petJsonUrl: resolvePetdexAsset(value[5]),
    sourcePageUrl: `https://petdex.dev/pets/${encodeURIComponent(slug)}`,
  };
}

function resolvePetdexAsset(reference: string): string {
  const url = new URL(reference, `${PETDEX_ASSET_BASE}/`);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'assets.petdex.dev' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Petdex 预览目录包含未受信任的素材地址。');
  }
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
