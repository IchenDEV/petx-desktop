export type LibrarySourceId =
  | 'petdex'
  | 'petshare'
  | 'github'
  | 'deviantart'
  | 'itch'
  | 'steam';

export interface LibrarySource {
  id: LibrarySourceId;
  name: string;
  capability: 'direct' | 'browse-only';
  url: string;
  shortNote: string;
  description: string;
  constraints: readonly string[];
}

export interface CatalogItem {
  slug: string;
  displayName: string;
  description: string | null;
  kind: string;
  submittedBy: string | null;
  spritesheetUrl: string;
  petJsonUrl: string;
  sourcePageUrl: string;
}

export interface CatalogResponse {
  generatedAt: string;
  total: number;
  stale: boolean;
  items: CatalogItem[];
}

export interface InstalledPet {
  source: DirectLibrarySourceId;
  slug: string;
  displayName: string;
  description: string | null;
  submittedBy: string | null;
  spritePath: string;
  sourcePageUrl: string;
  spriteVersionNumber: number;
  installedAtEpochSeconds: number;
  sha256: string;
}

export type DirectLibrarySourceId = Extract<
  LibrarySourceId,
  'petdex' | 'petshare'
>;

export const BUILTIN_PET_ID = 'frieren' as const;
export const BUILTIN_PET_MANIFEST_URL = '/pets/frieren/pet.json';

export type ActivePetRef =
  | {
      kind: 'builtin';
      id: typeof BUILTIN_PET_ID;
    }
  | {
      kind: 'installed';
      source: DirectLibrarySourceId;
      slug: string;
    };

export interface ResolvedActivePet {
  reference: ActivePetRef;
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: 1 | 2;
  spritePath: string | null;
  manifestUrl: string | null;
}

export const DEFAULT_ACTIVE_PET: ResolvedActivePet = {
  reference: { kind: 'builtin', id: BUILTIN_PET_ID },
  id: BUILTIN_PET_ID,
  displayName: 'Frieren',
  description: 'A quiet white-haired desktop companion.',
  spriteVersionNumber: 2,
  spritePath: null,
  manifestUrl: BUILTIN_PET_MANIFEST_URL,
};

export const LIBRARY_SOURCES: readonly LibrarySource[] = [
  {
    id: 'petdex',
    name: 'Petdex',
    capability: 'direct',
    url: 'https://petdex.dev',
    shortNote: '可直接收藏',
    description:
      '面向 Codex 动画宠物的公共画廊。PetX 会读取官方目录，并在本机校验清单和图集。',
    constraints: [
      '目录条目已经过 Petdex 审核，但不代表底层角色版权已获授权。',
      'PetX 只下载静态清单与图集，不会运行脚本或安装器。',
      '收藏后保留投稿者、来源页和文件摘要。',
    ],
  },
  {
    id: 'petshare',
    name: 'PetShare',
    capability: 'direct',
    url: 'https://petshare.idevlab.dev/',
    shortNote: '可直接收藏',
    description:
      '一个公开的 Codex 桌面人物目录。PetX 会逐项获取清单和图集，在本机校验后收藏。',
    constraints: [
      '站点当前没有提供作者、作品来源或许可字段。',
      '“可以下载”不等于允许再分发、公开展示或商用。',
      'PetX 不解压站点 ZIP，只读取并校验静态清单与 WebP 图集。',
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    capability: 'browse-only',
    url: 'https://github.com/topics/codex-pet',
    shortNote: '原站浏览',
    description:
      'GitHub 上已经有不少 Codex 宠物仓库，但包结构和美术授权并不统一。',
    constraints: [
      '仓库许可证未必覆盖其中的角色美术。',
      '首版不自动下载整个源码仓库或任意 Release ZIP。',
      '可在原站查看 codex-pet Topic、Release 和作者说明。',
    ],
  },
  {
    id: 'deviantart',
    name: 'DeviantArt',
    capability: 'browse-only',
    url: 'https://www.deviantart.com/search?q=shimeji',
    shortNote: '原站浏览',
    description:
      '作品浏览和原文件下载依赖 DeviantArt OAuth、作者设置与逐项许可。',
    constraints: [
      '“允许下载”不等于允许再包装、再分发或商用。',
      '购买内容与账号下载额度必须由 DeviantArt 处理。',
      '接入 OAuth 之前，PetX 只打开原作品页。',
    ],
  },
  {
    id: 'itch',
    name: 'itch.io',
    capability: 'browse-only',
    url: 'https://itch.io/search?q=desktop+pet',
    shortNote: '原站获取',
    description:
      'itch.io 适合发现独立桌面宠物项目，购买、领取和安装由项目页或 itch 客户端完成。',
    constraints: [
      '官方 API 没有开放全站任意项目文件下载。',
      'PetX 不抓取页面里的隐藏文件链接，也不复用浏览器 Cookie。',
      '免费、付费与账号限制都以项目页为准。',
    ],
  },
  {
    id: 'steam',
    name: 'Steam',
    capability: 'browse-only',
    url: 'https://steamcommunity.com/workshop/',
    shortNote: '需要 Steam',
    description:
      'Workshop 内容属于具体应用和 AppID，下载、订阅与更新都由 Steam 客户端负责。',
    constraints: [
      '不能把其他应用的 Workshop 内容直接抽出来装进 PetX。',
      'PetX 需要自己的 Steam AppID 和 Workshop 才能做原生接入。',
      '当前仅提供 Workshop 原站入口。',
    ],
  },
] as const;

export function sourceById(id: LibrarySourceId): LibrarySource {
  return LIBRARY_SOURCES.find((source) => source.id === id) ?? LIBRARY_SOURCES[0];
}

export function isDirectLibrarySource(
  id: LibrarySourceId,
): id is DirectLibrarySourceId {
  return id === 'petdex' || id === 'petshare';
}

export function libraryPetKey(
  source: DirectLibrarySourceId,
  slug: string,
) {
  return `${source}:${slug}`;
}

export function activePetKey(reference: ActivePetRef): string {
  return reference.kind === 'builtin'
    ? `builtin:${reference.id}`
    : libraryPetKey(reference.source, reference.slug);
}

export function isSameActivePetReference(
  left: ActivePetRef,
  right: ActivePetRef,
): boolean {
  return activePetKey(left) === activePetKey(right);
}

export function activePetMatchesInstalled(
  reference: ActivePetRef,
  source: DirectLibrarySourceId,
  slug: string,
): boolean {
  return reference.kind === 'installed' &&
    reference.source === source &&
    reference.slug === slug;
}

export function activePetDisplayDescriptor(pet: ResolvedActivePet) {
  return {
    displayName: pet.displayName,
    sourceLabel:
      pet.reference.kind === 'builtin'
        ? '内置伙伴'
        : sourceById(pet.reference.source).name,
  };
}

export function parseActivePetReference(value: unknown): ActivePetRef {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw invalidActivePetData();
  }
  if (value.kind === 'builtin') {
    if (value.id !== BUILTIN_PET_ID) throw invalidActivePetData();
    return { kind: 'builtin', id: BUILTIN_PET_ID };
  }
  if (
    value.kind !== 'installed' ||
    !isDirectLibrarySourceValue(value.source) ||
    !isValidInstalledSlug(value.slug)
  ) {
    throw invalidActivePetData();
  }
  return {
    kind: 'installed',
    source: value.source,
    slug: value.slug,
  };
}

export function parseResolvedActivePet(value: unknown): ResolvedActivePet {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim() === '' ||
    (value.description !== null && typeof value.description !== 'string') ||
    (value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) ||
    (value.spritePath !== null && typeof value.spritePath !== 'string') ||
    (value.manifestUrl !== null && typeof value.manifestUrl !== 'string')
  ) {
    throw invalidActivePetData();
  }

  const reference = parseActivePetReference(value.reference);
  if (reference.kind === 'builtin') {
    if (
      value.id !== reference.id ||
      value.spritePath !== null ||
      value.manifestUrl !== BUILTIN_PET_MANIFEST_URL
    ) {
      throw invalidActivePetData();
    }
  } else if (
    value.id !== reference.slug ||
    value.spritePath === null ||
    value.spritePath.trim() === '' ||
    value.manifestUrl !== null
  ) {
    throw invalidActivePetData();
  }

  return {
    reference,
    id: value.id,
    displayName: value.displayName,
    description: value.description,
    spriteVersionNumber: value.spriteVersionNumber,
    spritePath: value.spritePath,
    manifestUrl: value.manifestUrl,
  };
}

function isDirectLibrarySourceValue(
  value: unknown,
): value is DirectLibrarySourceId {
  return value === 'petdex' || value === 'petshare';
}

function isValidInstalledSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidActivePetData() {
  return new Error('当前伙伴数据无法识别。');
}
