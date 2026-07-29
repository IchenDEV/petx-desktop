import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '../platform';
import {
  BUILTIN_PET_MANIFEST_URL,
  DEFAULT_ACTIVE_PET,
  parseActivePetReference,
  parseResolvedActivePet,
} from './model';
import type {
  CatalogItem,
  CatalogResponse,
  DirectLibrarySourceId,
  InstalledPet,
  ResolvedActivePet,
} from './model';

const PREVIEW_MANIFEST_URL = '/__petdex/manifest';
const PETSHARE_PREVIEW_MANIFEST_URL = '/__petshare/catalog';
const PETDEX_ASSET_BASE = 'https://assets.petdex.dev';
const PETSHARE_ASSET_BASE = 'https://petshare.idevlab.dev';
const previewRequests = new Map<string, Promise<ResolvedPetPreview>>();

export const ACTIVE_PET_CHANGED_EVENT = 'petx://active-pet-changed';

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

export interface ActivePetAssets {
  spriteUrl?: string;
  manifestUrl?: string;
}

export async function fetchActivePet(): Promise<ResolvedActivePet> {
  if (!isTauri) return DEFAULT_ACTIVE_PET;
  return parseResolvedActivePet(await invoke<unknown>('get_active_pet'));
}

export const getActivePet = fetchActivePet;

export async function setActivePet(
  source: DirectLibrarySourceId,
  slug: string,
): Promise<ResolvedActivePet> {
  if (!isTauri) {
    throw new Error('请在 PetX 桌面版里更换当前伙伴。');
  }
  const reference = parseActivePetReference({
    kind: 'installed',
    source,
    slug,
  });
  if (reference.kind !== 'installed') {
    throw new Error('当前伙伴数据无法识别。');
  }
  return parseResolvedActivePet(
    await invoke<unknown>('set_active_pet', {
      source: reference.source,
      slug: reference.slug,
    }),
  );
}

export async function resetActivePet(): Promise<ResolvedActivePet> {
  if (!isTauri) return DEFAULT_ACTIVE_PET;
  return parseResolvedActivePet(await invoke<unknown>('reset_active_pet'));
}

export async function listenToActivePetChanges(
  onChange: (pet: ResolvedActivePet) => void,
  onInvalidPayload: (error: unknown) => void = (error) =>
    console.error('Unable to read the active pet change', error),
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<unknown>(ACTIVE_PET_CHANGED_EVENT, (event) => {
    try {
      onChange(parseResolvedActivePet(event.payload));
    } catch (error) {
      onInvalidPayload(error);
    }
  });
}

export function resolveActivePetAssets(
  pet: ResolvedActivePet,
): ActivePetAssets {
  if (pet.reference.kind === 'builtin') {
    return { manifestUrl: BUILTIN_PET_MANIFEST_URL };
  }
  if (pet.spritePath === null) {
    throw new Error('当前伙伴缺少本地图集。');
  }
  return { spriteUrl: convertFileSrc(pet.spritePath) };
}

export async function fetchPetdexCatalog(): Promise<CatalogResponse> {
  if (isTauri) return invoke<CatalogResponse>('get_petdex_catalog');

  const response = await fetch(PREVIEW_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`预览目录请求失败（HTTP ${response.status}）。`);
  }
  return parseCompactManifest(await response.json());
}

export async function fetchPetshareCatalog(): Promise<CatalogResponse> {
  if (isTauri) return invoke<CatalogResponse>('get_petshare_catalog');

  const response = await fetch(PETSHARE_PREVIEW_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`PetShare 预览目录请求失败（HTTP ${response.status}）。`);
  }
  return parsePetshareManifest(await response.json());
}

export function fetchCatalog(
  source: DirectLibrarySourceId,
): Promise<CatalogResponse> {
  return source === 'petdex'
    ? fetchPetdexCatalog()
    : fetchPetshareCatalog();
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

export async function installPetsharePet(
  slug: string,
): Promise<InstalledPet> {
  if (!isTauri) {
    throw new Error('请在 PetX 桌面版里把伙伴收进本地宠物库。');
  }
  return invoke<InstalledPet>('install_petshare_pet', { slug });
}

export function installCatalogPet(
  source: DirectLibrarySourceId,
  slug: string,
): Promise<InstalledPet> {
  return source === 'petdex'
    ? installPetdexPet(slug)
    : installPetsharePet(slug);
}

export function fetchPetdexPreview(
  slug: string,
  spritesheetUrl: string,
  petJsonUrl: string,
): Promise<ResolvedPetPreview> {
  return fetchCatalogPreview(
    'petdex',
    slug,
    spritesheetUrl,
    petJsonUrl,
  );
}

export function fetchCatalogPreview(
  source: DirectLibrarySourceId,
  slug: string,
  spritesheetUrl: string,
  petJsonUrl: string,
): Promise<ResolvedPetPreview> {
  const cacheKey = `${source}|${slug}|${spritesheetUrl}|${petJsonUrl}`;
  const existing = previewRequests.get(cacheKey);
  if (existing) return existing;

  const request = resolveCatalogPreview(
    source,
    slug,
    spritesheetUrl,
    petJsonUrl,
  ).finally(() => previewRequests.delete(cacheKey));
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

async function resolveCatalogPreview(
  source: DirectLibrarySourceId,
  slug: string,
  spritesheetUrl: string,
  petJsonUrl: string,
): Promise<ResolvedPetPreview> {
  if (isTauri) {
    const command =
      source === 'petdex' ? 'get_petdex_preview' : 'get_petshare_preview';
    const cached = await invoke<CachedPetdexPreview>(command, { slug });
    return {
      spriteUrl: convertFileSrc(cached.spritePath),
      thumbnailUrl: convertFileSrc(cached.thumbnailPath),
      thumbnailIsSheet: false,
      spriteVersionNumber: cached.spriteVersionNumber,
      sha256: cached.sha256,
    };
  }

  const trustedUrl = new URL(
    source === 'petdex'
      ? resolvePetdexAsset(spritesheetUrl)
      : resolvePetshareAsset(slug, spritesheetUrl, 'spritesheet.webp'),
  );
  const trustedManifestUrl = new URL(
    source === 'petdex'
      ? resolvePetdexAsset(petJsonUrl)
      : resolvePetshareAsset(slug, petJsonUrl, 'pet.json'),
  );
  const proxyBase =
    source === 'petdex' ? '/__petdex/assets' : '/__petshare/assets';
  const proxiedUrl = `${proxyBase}${trustedUrl.pathname}`;
  const manifestResponse = await fetch(
    `${proxyBase}${trustedManifestUrl.pathname}`,
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
    description: null,
    kind: value[2],
    submittedBy: value[3],
    spritesheetUrl: resolvePetdexAsset(value[4]),
    petJsonUrl: resolvePetdexAsset(value[5]),
    sourcePageUrl: `https://petdex.dev/pets/${encodeURIComponent(slug)}`,
  };
}

function parsePetshareManifest(value: unknown): CatalogResponse {
  if (!Array.isArray(value)) {
    throw new Error('PetShare 预览目录格式无法识别。');
  }
  const seen = new Set<string>();
  const items = value.map((entry) => parsePetshareItem(entry, seen));
  return {
    generatedAt: '',
    total: items.length,
    stale: false,
    items,
  };
}

function parsePetshareItem(
  value: unknown,
  seen: Set<string>,
): CatalogItem {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.description !== 'string' ||
    value.spriteVersionNumber !== 2 ||
    typeof value.spritesheetPath !== 'string' ||
    typeof value.manifestPath !== 'string' ||
    typeof value.downloadPath !== 'string'
  ) {
    throw new Error('PetShare 预览目录中有无法识别的条目。');
  }
  const slug = value.id;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || seen.has(slug)) {
    throw new Error('PetShare 预览目录包含无效或重复的宠物 id。');
  }
  seen.add(slug);
  const spritesheetUrl = resolvePetshareAsset(
    slug,
    value.spritesheetPath,
    'spritesheet.webp',
  );
  const petJsonUrl = resolvePetshareAsset(
    slug,
    value.manifestPath,
    'pet.json',
  );
  if (value.downloadPath !== `/downloads/${slug}.zip`) {
    throw new Error('PetShare 预览目录包含未受信任的下载路径。');
  }
  return {
    slug,
    displayName: value.displayName,
    description: value.description,
    kind: 'character',
    submittedBy: null,
    spritesheetUrl,
    petJsonUrl,
    sourcePageUrl: `${PETSHARE_ASSET_BASE}/`,
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

function resolvePetshareAsset(
  slug: string,
  reference: string,
  filename: 'pet.json' | 'spritesheet.webp',
): string {
  const expectedPath = `/pets/${slug}/${filename}`;
  const expectedUrl = `${PETSHARE_ASSET_BASE}${expectedPath}`;
  const url = new URL(reference, `${PETSHARE_ASSET_BASE}/`);
  if (
    (reference !== expectedPath && reference !== expectedUrl) ||
    url.protocol !== 'https:' ||
    url.hostname !== 'petshare.idevlab.dev' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== expectedPath ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('PetShare 预览目录包含未受信任的素材地址。');
  }
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
