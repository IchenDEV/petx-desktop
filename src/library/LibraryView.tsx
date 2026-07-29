import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../platform';
import {
  fetchInstalledPets,
  fetchCatalog,
  installCatalogPet,
  installedSpriteUrl,
  openExternalPage,
} from './client';
import {
  isDirectLibrarySource,
  LIBRARY_SOURCES,
  libraryPetKey,
  sourceById,
  type CatalogItem,
  type CatalogResponse,
  type DirectLibrarySourceId,
  type InstalledPet,
  type LibrarySourceId,
} from './model';
import { PetPreview } from './PetPreview';

const INITIAL_RESULT_LIMIT = 72;
const RESULT_LIMIT_STEP = 72;
const CATALOG_REFRESH_INTERVAL_MS = 10 * 60 * 1_000;

type Notice = {
  tone: 'status' | 'error';
  text: string;
  sourceId?: LibrarySourceId;
};

export function LibraryView() {
  const [sourceId, setSourceId] = useState<LibrarySourceId>('petdex');
  const [catalogs, setCatalogs] = useState<
    Partial<Record<DirectLibrarySourceId, CatalogResponse>>
  >({});
  const [catalogErrors, setCatalogErrors] = useState<
    Partial<Record<DirectLibrarySourceId, string>>
  >({});
  const [loadingSources, setLoadingSources] = useState<
    ReadonlySet<DirectLibrarySourceId>
  >(() => new Set());
  const [installed, setInstalled] = useState<InstalledPet[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [resultLimit, setResultLimit] = useState(INITIAL_RESULT_LIMIT);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catalogsRef = useRef(catalogs);
  const catalogRequests = useRef(new Set<DirectLibrarySourceId>());
  const catalogLoadedAt = useRef<
    Partial<Record<DirectLibrarySourceId, number>>
  >({});
  catalogsRef.current = catalogs;
  const deferredQuery = useDeferredValue(query);
  const directSourceId = isDirectLibrarySource(sourceId)
    ? sourceId
    : null;
  const catalog = directSourceId ? catalogs[directSourceId] ?? null : null;
  const catalogError = directSourceId
    ? catalogErrors[directSourceId] ?? null
    : null;
  const loading =
    directSourceId !== null && loadingSources.has(directSourceId);

  const installedByKey = useMemo(
    () =>
      new Map(
        installed.map((pet) => [
          libraryPetKey(pet.source, pet.slug),
          pet,
        ]),
      ),
    [installed],
  );

  const loadCatalog = useCallback(async (target: DirectLibrarySourceId) => {
    if (catalogRequests.current.has(target)) return;
    catalogRequests.current.add(target);
    setLoadingSources((current) => new Set(current).add(target));
    setCatalogErrors((current) => {
      const next = { ...current };
      delete next[target];
      return next;
    });
    setNotice(null);
    try {
      const result = await fetchCatalog(target);
      catalogLoadedAt.current[target] = Date.now();
      setCatalogs((current) => ({ ...current, [target]: result }));
    } catch (error) {
      if (catalogsRef.current[target]) {
        setNotice({
          tone: 'error',
          sourceId: target,
          text: `${sourceById(target).name} 更新失败，继续显示上一次打开的目录。`,
        });
      } else {
        setCatalogErrors((current) => ({
          ...current,
          [target]: errorMessage(error),
        }));
      }
    } finally {
      catalogRequests.current.delete(target);
      setLoadingSources((current) => {
        const next = new Set(current);
        next.delete(target);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    document.body.classList.add('library-mode');
    void fetchInstalledPets()
      .then(setInstalled)
      .catch((error: unknown) => {
        console.error('Unable to read installed pets', error);
        setNotice({
          tone: 'error',
          text: '目录可以浏览，但暂时无法读取本地宠物库。',
        });
      });
    return () => document.body.classList.remove('library-mode');
  }, []);

  useEffect(() => {
    if (
      directSourceId === null ||
      catalogErrors[directSourceId] ||
      loadingSources.has(directSourceId)
    ) {
      return;
    }
    const catalogExpired =
      Date.now() - (catalogLoadedAt.current[directSourceId] ?? 0) >=
      CATALOG_REFRESH_INTERVAL_MS;
    if (catalogs[directSourceId] && !catalogExpired) return;
    void loadCatalog(directSourceId);
  }, [
    catalogErrors,
    catalogs,
    directSourceId,
    loadCatalog,
    loadingSources,
  ]);

  useEffect(() => {
    if (directSourceId === null) return;
    const refreshIfExpired = () => {
      const loadedAt = catalogLoadedAt.current[directSourceId] ?? 0;
      if (Date.now() - loadedAt >= CATALOG_REFRESH_INTERVAL_MS) {
        void loadCatalog(directSourceId);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfExpired();
    };
    window.addEventListener('focus', refreshIfExpired);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshIfExpired);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [directSourceId, loadCatalog]);

  useEffect(() => {
    if (directSourceId === null) return;
    setSelectedSlug((current) =>
      current && catalog?.items.some((item) => item.slug === current)
        ? current
        : (catalog?.items[0]?.slug ?? null),
    );
  }, [catalog, directSourceId]);

  useEffect(() => {
    setResultLimit(INITIAL_RESULT_LIMIT);
  }, [deferredQuery, onlyInstalled, sourceId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        if (query) {
          setQuery('');
          searchRef.current?.focus();
        } else {
          void closeLibrary();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [query]);

  const filteredItems = useMemo(() => {
    const normalized = normalizeSearch(deferredQuery);
    return (catalog?.items ?? []).filter((item) => {
      if (
        onlyInstalled &&
        directSourceId &&
        !installedByKey.has(libraryPetKey(directSourceId, item.slug))
      ) {
        return false;
      }
      if (!normalized) return true;
      const haystack = normalizeSearch(
        `${item.displayName} ${item.slug} ${item.description ?? ''} ${item.submittedBy ?? ''}`,
      );
      return haystack.includes(normalized);
    });
  }, [
    catalog?.items,
    deferredQuery,
    directSourceId,
    installedByKey,
    onlyInstalled,
  ]);

  const selectedItem = useMemo(
    () =>
      filteredItems.find((item) => item.slug === selectedSlug) ??
      filteredItems[0] ??
      null,
    [filteredItems, selectedSlug],
  );
  const selectedInstalled = selectedItem && directSourceId
    ? installedByKey.get(libraryPetKey(directSourceId, selectedItem.slug))
    : undefined;
  const source = sourceById(sourceId);
  const visibleNotice =
    notice?.sourceId === undefined || notice.sourceId === sourceId
      ? notice
      : null;

  const installSelected = async () => {
    if (!selectedItem || !directSourceId || installingKey) return;
    const key = libraryPetKey(directSourceId, selectedItem.slug);
    setInstallingKey(key);
    setNotice(null);
    try {
      const pet = await installCatalogPet(
        directSourceId,
        selectedItem.slug,
      );
      setInstalled((current) => [
        ...current.filter(
          (item) =>
            libraryPetKey(item.source, item.slug) !==
            libraryPetKey(pet.source, pet.slug),
        ),
        pet,
      ]);
      setNotice({
        tone: 'status',
        sourceId: directSourceId,
        text: `${pet.displayName} 已收进本地宠物库，可离线预览。`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        sourceId: directSourceId,
        text: errorMessage(error),
      });
    } finally {
      setInstallingKey(null);
    }
  };

  const openPage = async (url: string) => {
    try {
      await openExternalPage(url);
    } catch (error) {
      setNotice({
        tone: 'error',
        sourceId,
        text: `没有打开系统浏览器：${errorMessage(error)}`,
      });
    }
  };

  return (
    <main className="library-view">
      <header className="library-header">
        <div>
          <h1>发现新伙伴</h1>
          <p>从可信目录挑选，先检查，再收进本地。</p>
        </div>
        <div className="library-search-tools">
          <label className="library-search">
            <span className="sr-only">搜索名字、描述或作者</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="搜索名字、描述或作者"
              disabled={directSourceId === null}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ F</kbd>
          </label>
          <label
            className={
              directSourceId !== null
                ? 'library-installed-filter'
                : 'library-installed-filter is-disabled'
            }
          >
            <input
              type="checkbox"
              checked={onlyInstalled}
              disabled={directSourceId === null}
              onChange={(event) => setOnlyInstalled(event.target.checked)}
            />
            <span>只看已收藏</span>
          </label>
        </div>
      </header>

      <div className="library-workspace">
        <nav className="library-sources" aria-label="宠物来源">
          <p className="library-sources__label">来源</p>
          {LIBRARY_SOURCES.map((item) => (
            <button
              className={
                sourceId === item.id
                  ? 'library-source is-selected'
                  : 'library-source'
              }
              type="button"
              key={item.id}
              onClick={() => {
                setSourceId(item.id);
                setNotice(null);
              }}
            >
              <span>{item.name}</span>
              <small>
                {item.shortNote}
                {item.capability === 'browse-only' ? ' ↗' : ''}
              </small>
            </button>
          ))}
          <div className="library-sources__note">
            <span aria-hidden="true">※</span>
            <p>不同平台的“可下载”，不等于可再分发。</p>
          </div>
        </nav>

        {directSourceId !== null ? (
          <>
            <section
              className="library-catalog"
              aria-label={`${source.name} 宠物目录`}
            >
              <div className="library-catalog__heading">
                <div>
                  <h2>{source.name} 目录</h2>
                  <p>
                    {loading
                      ? catalog
                        ? `正在更新 · ${filteredItems.length.toLocaleString('zh-CN')} 只伙伴`
                        : '正在取回目录'
                      : catalogError
                        ? '目录暂不可用'
                        : `${filteredItems.length.toLocaleString('zh-CN')} 只伙伴`}
                  </p>
                </div>
                {catalog?.stale ? <span>离线缓存</span> : null}
              </div>

              {loading && !catalog ? (
                <LibraryLoading label="正在整理伙伴档案…" />
              ) : catalogError && !catalog ? (
                <LibraryError
                  message={catalogError}
                  onRetry={() => void loadCatalog(directSourceId)}
                />
              ) : filteredItems.length === 0 ? (
                <LibraryEmpty onlyInstalled={onlyInstalled} query={query} />
              ) : (
                <div className="library-catalog__scroll">
                  <ol className="library-pet-list">
                    {filteredItems.slice(0, resultLimit).map((item) => {
                      const itemKey = libraryPetKey(
                        directSourceId,
                        item.slug,
                      );
                      const localPet = installedByKey.get(itemKey);
                      const installing = installingKey === itemKey;
                      return (
                        <li key={itemKey}>
                          <button
                            className={
                              selectedItem?.slug === item.slug
                                ? 'library-pet-row is-selected'
                                : 'library-pet-row'
                            }
                            type="button"
                            aria-pressed={selectedItem?.slug === item.slug}
                            onClick={() => setSelectedSlug(item.slug)}
                          >
                            <PetPreview
                              id={item.slug}
                              name={item.displayName}
                              source={directSourceId}
                              localSrc={
                                localPet
                                  ? installedSpriteUrl(localPet)
                                  : undefined
                              }
                              localSpriteVersionNumber={
                                localPet?.spriteVersionNumber
                              }
                              catalogSrc={
                                localPet ? undefined : item.spritesheetUrl
                              }
                              catalogManifestSrc={
                                localPet ? undefined : item.petJsonUrl
                              }
                              size={68}
                            />
                            <span className="library-pet-row__copy">
                              <strong>{item.displayName}</strong>
                              <span>
                                {item.submittedBy
                                  ? `投稿者 ${item.submittedBy}`
                                  : directSourceId === 'petshare'
                                    ? '站点未提供作者'
                                    : '投稿者未署名'}
                              </span>
                              <small>{kindLabel(item.kind)}</small>
                            </span>
                            <span
                              className={
                                installing
                                  ? 'library-pet-row__state is-working'
                                  : 'library-pet-row__state'
                              }
                            >
                              {installing
                                ? '检查中'
                                : localPet
                                  ? '已收藏'
                                  : ''}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  {resultLimit < filteredItems.length ? (
                    <button
                      className="library-load-more"
                      type="button"
                      onClick={() =>
                        setResultLimit((current) => current + RESULT_LIMIT_STEP)
                      }
                    >
                      再看 {Math.min(RESULT_LIMIT_STEP, filteredItems.length - resultLimit)} 只
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            <section className="library-detail" aria-live="polite">
              {selectedItem ? (
                <PetDetail
                  key={libraryPetKey(directSourceId, selectedItem.slug)}
                  item={selectedItem}
                  sourceId={directSourceId}
                  installed={selectedInstalled}
                  installing={
                    installingKey ===
                    libraryPetKey(directSourceId, selectedItem.slug)
                  }
                  libraryBusy={installingKey !== null}
                  installAvailable={isTauri}
                  onInstall={installSelected}
                  onOpenSource={() => void openPage(selectedItem.sourcePageUrl)}
                />
              ) : (
                <div className="library-detail__empty">
                  <p>从左边挑一只伙伴看看。</p>
                </div>
              )}
            </section>
          </>
        ) : (
          <ExternalSourceView
            sourceId={sourceId}
            onOpen={() => void openPage(source.url)}
          />
        )}
      </div>

      <footer className="library-footer">
        <p>{catalogStatus(catalog, sourceId)}</p>
        <p
          className={
            visibleNotice?.tone === 'error'
              ? 'library-notice is-error'
              : 'library-notice'
          }
          role="status"
        >
          {visibleNotice?.text ?? '收藏不会改变你和当前伙伴的关系。'}
        </p>
      </footer>
    </main>
  );
}

interface PetDetailProps {
  item: CatalogItem;
  sourceId: DirectLibrarySourceId;
  installed?: InstalledPet;
  installing: boolean;
  libraryBusy: boolean;
  installAvailable: boolean;
  onInstall: () => void;
  onOpenSource: () => void;
}

function PetDetail({
  item,
  sourceId,
  installed,
  installing,
  libraryBusy,
  installAvailable,
  onInstall,
  onOpenSource,
}: PetDetailProps) {
  const source = sourceById(sourceId);
  const [previewState, setPreviewState] = useState<
    'loading' | 'ready' | 'failed'
  >(installed ? 'ready' : 'loading');

  useEffect(() => {
    setPreviewState(installed ? 'ready' : 'loading');
  }, [installed, item.slug, sourceId]);

  const handlePreviewReady = useCallback(() => {
    setPreviewState('ready');
  }, []);
  const handlePreviewError = useCallback(() => {
    setPreviewState('failed');
  }, []);

  return (
    <div className="library-detail__content">
      <div className="library-preview-stage">
        <PetPreview
          id={item.slug}
          name={item.displayName}
          source={sourceId}
          localSrc={installed ? installedSpriteUrl(installed) : undefined}
          localSpriteVersionNumber={installed?.spriteVersionNumber}
          catalogSrc={installed ? undefined : item.spritesheetUrl}
          catalogManifestSrc={installed ? undefined : item.petJsonUrl}
          size={210}
          animate
          eager
          onReady={handlePreviewReady}
          onError={handlePreviewError}
        />
        {installed ? <span className="library-preview-stamp">本地收藏</span> : null}
      </div>

      <div className="library-detail__title">
        <h2>{item.displayName}</h2>
        <p>{item.slug}</p>
      </div>

      {item.description ? (
        <p className="library-detail__description">{item.description}</p>
      ) : null}

      <dl className="library-detail__facts">
        <div>
          <dt>作者</dt>
          <dd>
            {item.submittedBy ??
              (sourceId === 'petshare' ? '站点未提供' : '未署名')}
          </dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{source.name}</dd>
        </div>
        <div>
          <dt>格式</dt>
          <dd>PetX / Codex 图集</dd>
        </div>
      </dl>

      <div className="library-detail__statuses" aria-label="兼容与授权状态">
        <span>PetX 兼容</span>
        <span className="is-caution">
          {sourceId === 'petshare' ? '许可未声明' : '授权需自行确认'}
        </span>
      </div>

      <button
        className="library-install-button"
        type="button"
        disabled={
          Boolean(installed) ||
          libraryBusy ||
          installing ||
          !installAvailable ||
          previewState !== 'ready'
        }
        onClick={onInstall}
      >
        {installing
          ? '正在检查并收进宠物库…'
          : installed
            ? '已在本地宠物库'
            : libraryBusy
              ? '正在处理另一只伙伴…'
            : !installAvailable
              ? '桌面版可收藏'
              : previewState === 'failed'
                ? '预览不可用'
                : previewState === 'loading'
                  ? '正在准备预览…'
                  : '收进宠物库'}
      </button>
      {installing ? (
        <div className="library-install-progress" aria-hidden="true">
          <span />
        </div>
      ) : null}
      <button
        className="library-source-link"
        type="button"
        onClick={onOpenSource}
      >
        在 {source.name} 查看 <span aria-hidden="true">↗</span>
      </button>

      <p className="library-safety-note">
        <span aria-hidden="true">◆</span>
        收藏会复用刚刚预览并校验过的图集，不会运行代码。
      </p>
      <p className="library-rights-note">
        {sourceId === 'petshare'
          ? 'PetShare 当前没有提供作者、作品来源或许可字段。个人收藏不等于获得再分发、公开展示或商用授权。'
          : 'Petdex 的社区审核不等于角色版权许可。请在公开展示、再分发或商用前确认作者与权利方要求。'}
      </p>
    </div>
  );
}

function ExternalSourceView({
  sourceId,
  onOpen,
}: {
  sourceId: LibrarySourceId;
  onOpen: () => void;
}) {
  const source = sourceById(sourceId);
  return (
    <section className="library-external" aria-labelledby="external-source-title">
      <div className="library-external__index">
        <p>更多来源 / {source.name}</p>
        <span>只在原站浏览</span>
      </div>
      <div className="library-external__body">
        <div className="library-external__monogram" aria-hidden="true">
          {source.name.slice(0, 2)}
        </div>
        <h2 id="external-source-title">{source.name}</h2>
        <p className="library-external__lead">{source.description}</p>
        <ul>
          {source.constraints.map((constraint) => (
            <li key={constraint}>{constraint}</li>
          ))}
        </ul>
        <button type="button" onClick={onOpen}>
          在 {source.name} 浏览 <span aria-hidden="true">↗</span>
        </button>
      </div>
      <aside>
        <p>为什么不直接下载？</p>
        <strong>平台负责账号、许可或客户端流程。</strong>
        <span>
          PetX 不会抓取隐藏链接、复用登录 Cookie，或绕过购买与订阅。
        </span>
      </aside>
    </section>
  );
}

function LibraryLoading({ label }: { label: string }) {
  return (
    <div className="library-loading" role="status">
      <span className="library-loading__mark" aria-hidden="true">
        ◇
      </span>
      <p>{label}</p>
      <div aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

function LibraryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="library-error" role="alert">
      <h3>暂时翻不到目录</h3>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        再试一次
      </button>
    </div>
  );
}

function LibraryEmpty({
  onlyInstalled,
  query,
}: {
  onlyInstalled: boolean;
  query: string;
}) {
  return (
    <div className="library-empty">
      <h3>这里还没有结果</h3>
      <p>
        {onlyInstalled
          ? '本地收藏里没有符合条件的伙伴。'
          : query
            ? `没有找到与“${query}”相符的名字、描述或作者。`
            : '目录暂时是空的。'}
      </p>
    </div>
  );
}

async function closeLibrary() {
  if (!isTauri) {
    window.close();
    return;
  }
  await getCurrentWindow().close();
}

function normalizeSearch(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function kindLabel(kind: string) {
  if (kind === 'character') return '角色伙伴';
  if (kind === 'object') return '物件伙伴';
  if (kind === 'animal') return '动物伙伴';
  return kind || '动画伙伴';
}

function catalogStatus(
  catalog: CatalogResponse | null,
  sourceId: LibrarySourceId,
) {
  if (!isDirectLibrarySource(sourceId)) {
    return '外部来源会交给系统浏览器打开';
  }
  if (!catalog) return `${sourceById(sourceId).name} 公开目录`;
  if (sourceId === 'petshare') {
    return catalog.stale
      ? `PetShare 离线目录 · ${catalog.total.toLocaleString('zh-CN')} 只`
      : `PetShare 公开快照 · ${catalog.total.toLocaleString('zh-CN')} 只`;
  }
  const date = new Date(catalog.generatedAt);
  const formatted = Number.isNaN(date.getTime())
    ? '最近一次'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
  return catalog.stale
    ? `离线目录 · ${formatted} 更新`
    : `目录已更新 · ${formatted} · ${catalog.total.toLocaleString('zh-CN')} 只`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '发生了无法识别的错误。';
}
