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
  chooseAndImportLocalPet,
  fetchActivePet,
  fetchInstalledPets,
  fetchCatalog,
  installCatalogPet,
  installedSpriteUrl,
  listenToActivePetChanges,
  openExternalPage,
  resetActivePet,
  setActivePet,
} from './client';
import {
  activePetKey,
  activePetMatchesInstalled,
  DEFAULT_ACTIVE_PET,
  isDirectLibrarySource,
  LIBRARY_SOURCES,
  libraryPetKey,
  sourceById,
  sortInstalledPetsByHistory,
  installedPetSourceLabel,
  type CatalogItem,
  type CatalogResponse,
  type DirectLibrarySourceId,
  type InstalledPet,
  type LibrarySourceId,
  type ResolvedActivePet,
} from './model';
import { PetPreview } from './PetPreview';

const INITIAL_RESULT_LIMIT = 72;
const RESULT_LIMIT_STEP = 72;
const CATALOG_REFRESH_INTERVAL_MS = 10 * 60 * 1_000;
const DEFAULT_ACTIVE_PET_KEY = activePetKey(DEFAULT_ACTIVE_PET.reference);

type Notice = {
  tone: 'status' | 'error';
  text: string;
  sourceId?: LibrarySourceId;
};

export function LibraryView() {
  const [sourceId, setSourceId] = useState<LibrarySourceId>('local');
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
  const [installedLoading, setInstalledLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedLocalKey, setSelectedLocalKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [resultLimit, setResultLimit] = useState(INITIAL_RESULT_LIMIT);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [activePet, setActivePetState] = useState<ResolvedActivePet | null>(
    null,
  );
  const [activePetLoading, setActivePetLoading] = useState(true);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catalogsRef = useRef(catalogs);
  const catalogRequests = useRef(new Set<DirectLibrarySourceId>());
  const activePetRef = useRef<ResolvedActivePet | null>(null);
  const activePetRequest = useRef(0);
  const activePetMutation = useRef<string | null>(null);
  const catalogLoadedAt = useRef<
    Partial<Record<DirectLibrarySourceId, number>>
  >({});
  catalogsRef.current = catalogs;
  activePetRef.current = activePet;
  const deferredQuery = useDeferredValue(query);
  const localMode = sourceId === 'local';
  const directSourceId = isDirectLibrarySource(sourceId)
    ? sourceId
    : null;
  const catalog = directSourceId ? catalogs[directSourceId] ?? null : null;
  const catalogError = directSourceId
    ? catalogErrors[directSourceId] ?? null
    : null;
  const loading =
    directSourceId !== null && loadingSources.has(directSourceId);

  const localHistory = useMemo(() => {
    const normalized = normalizeSearch(deferredQuery);
    const history = sortInstalledPetsByHistory(installed);
    if (!normalized) return history;
    return history.filter((pet) =>
      normalizeSearch(
        `${pet.displayName} ${pet.slug} ${pet.description ?? ''} ${pet.submittedBy ?? ''} ${installedPetSourceLabel(pet.source)}`,
      ).includes(normalized),
    );
  }, [deferredQuery, installed]);

  const selectedLocalPet = useMemo(
    () =>
      localHistory.find(
        (pet) => libraryPetKey(pet.source, pet.slug) === selectedLocalKey,
      ) ??
      localHistory[0] ??
      null,
    [localHistory, selectedLocalKey],
  );

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

  const refreshInstalled = useCallback(async (reportError = false) => {
    try {
      setInstalled(await fetchInstalledPets());
    } catch (error) {
      console.error('Unable to read installed pets', error);
      if (reportError) {
        setNotice({
          tone: 'error',
          text: '暂时无法读取这台电脑上的伙伴与使用历史。',
        });
      }
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  const refreshActivePet = useCallback(async (reportError = false) => {
    if (activePetMutation.current !== null) return;
    const request = ++activePetRequest.current;
    if (activePetRef.current === null) setActivePetLoading(true);
    try {
      const next = await fetchActivePet();
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== null
      ) {
        return;
      }
      activePetRef.current = next;
      setActivePetState(next);
    } catch (error) {
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== null
      ) {
        return;
      }
      if (reportError) {
        setNotice({
          tone: 'error',
          text: `暂时无法确认当前伙伴：${errorMessage(error)}`,
        });
      }
    } finally {
      if (
        request === activePetRequest.current &&
        activePetMutation.current === null
      ) {
        setActivePetLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    document.body.classList.add('library-mode');
    void refreshInstalled(true);
    return () => document.body.classList.remove('library-mode');
  }, [refreshInstalled]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void refreshActivePet(true);
    void listenToActivePetChanges(
      () => {
        if (!disposed) void refreshActivePet();
      },
      () => {
        if (!disposed) void refreshActivePet(true);
      },
    )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          stopListening = unlisten;
          void refreshActivePet();
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to listen for active pet changes', error);
      });

    const refreshWhenFocused = () => void refreshActivePet();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshActivePet();
      }
    };
    window.addEventListener('focus', refreshWhenFocused);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      disposed = true;
      activePetRequest.current += 1;
      stopListening?.();
      window.removeEventListener('focus', refreshWhenFocused);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshActivePet]);

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
    if (!localMode) return;
    setSelectedLocalKey((current) => {
      if (
        current &&
        localHistory.some(
          (pet) => libraryPetKey(pet.source, pet.slug) === current,
        )
      ) {
        return current;
      }
      const activeKey =
        activePet?.reference.kind === 'installed'
          ? activePetKey(activePet.reference)
          : null;
      if (
        activeKey &&
        localHistory.some(
          (pet) => libraryPetKey(pet.source, pet.slug) === activeKey,
        )
      ) {
        return activeKey;
      }
      const first = localHistory[0];
      return first ? libraryPetKey(first.source, first.slug) : null;
    });
  }, [activePet?.reference, localHistory, localMode]);

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
  const selectedIsActive =
    selectedItem !== null &&
    directSourceId !== null &&
    activePet !== null &&
    activePetMatchesInstalled(
      activePet.reference,
      directSourceId,
      selectedItem.slug,
    );
  const selectedLocalIsActive =
    selectedLocalPet !== null &&
    activePet !== null &&
    activePetMatchesInstalled(
      activePet.reference,
      selectedLocalPet.source,
      selectedLocalPet.slug,
    );
  const restoringDefault = switchingKey === DEFAULT_ACTIVE_PET_KEY;
  const selectedIsSwitching =
    (selectedItem !== null &&
      directSourceId !== null &&
      switchingKey === libraryPetKey(directSourceId, selectedItem.slug)) ||
    (restoringDefault && selectedIsActive);
  const selectedLocalIsSwitching =
    (selectedLocalPet !== null &&
      switchingKey ===
        libraryPetKey(selectedLocalPet.source, selectedLocalPet.slug)) ||
    (restoringDefault && selectedLocalIsActive);
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
        text: `${pet.displayName} 已收藏，可以立即设为当前伙伴；桌面上的伙伴没有改变。`,
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

  const activateInstalled = async (
    pet: InstalledPet,
    noticeSourceId?: LibrarySourceId,
  ) => {
    if (
      activePetMutation.current !== null ||
      (activePet !== null &&
        activePetMatchesInstalled(activePet.reference, pet.source, pet.slug))
    ) {
      return;
    }

    const key = libraryPetKey(pet.source, pet.slug);
    const previousName = activePetRef.current?.displayName ?? '原来的伙伴';
    const request = ++activePetRequest.current;
    activePetMutation.current = key;
    setSwitchingKey(key);
    setNotice(null);
    try {
      const next = await setActivePet(pet.source, pet.slug);
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== key
      ) {
        return;
      }
      activePetRef.current = next;
      setActivePetState(next);
      setActivePetLoading(false);
      setNotice({
        tone: 'status',
        sourceId: noticeSourceId,
        text: `${next.displayName} 现在正在桌面陪伴你。`,
      });
      void refreshInstalled();
    } catch (error) {
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== key
      ) {
        return;
      }
      setNotice({
        tone: 'error',
        sourceId: noticeSourceId,
        text: `没能把 ${pet.displayName} 设为当前伙伴，${previousName} 仍在陪伴你。${errorMessage(error)}`,
      });
    } finally {
      if (
        request === activePetRequest.current &&
        activePetMutation.current === key
      ) {
        activePetMutation.current = null;
        setSwitchingKey(null);
      }
    }
  };

  const activateSelected = () => {
    if (!selectedInstalled || !directSourceId || selectedIsActive) return;
    return activateInstalled(selectedInstalled, directSourceId);
  };

  const importLocal = async () => {
    if (importing || installingKey !== null || switchingKey !== null) return;
    setImporting(true);
    setNotice(null);
    try {
      const imported = await chooseAndImportLocalPet();
      if (!imported) return;
      setInstalled((current) => [
        imported,
        ...current.filter(
          (pet) =>
            libraryPetKey(pet.source, pet.slug) !==
            libraryPetKey(imported.source, imported.slug),
        ),
      ]);
      setSourceId('local');
      setSelectedLocalKey(libraryPetKey(imported.source, imported.slug));
      setNotice({
        tone: 'status',
        text: `${imported.displayName} 已导入“我的伙伴”，现在可以设为当前伙伴。`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `没有导入这只伙伴：${errorMessage(error)}`,
      });
    } finally {
      setImporting(false);
    }
  };

  const restoreDefault = async () => {
    if (
      activePetMutation.current !== null ||
      activePetRef.current?.reference.kind !== 'installed'
    ) {
      return;
    }

    const previousName = activePetRef.current.displayName;
    const request = ++activePetRequest.current;
    activePetMutation.current = DEFAULT_ACTIVE_PET_KEY;
    setSwitchingKey(DEFAULT_ACTIVE_PET_KEY);
    setNotice(null);
    try {
      const next = await resetActivePet();
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== DEFAULT_ACTIVE_PET_KEY
      ) {
        return;
      }
      activePetRef.current = next;
      setActivePetState(next);
      setActivePetLoading(false);
      setNotice({
        tone: 'status',
        text: 'Frieren 已回到桌面，其他伙伴仍留在本地宠物库。',
      });
    } catch (error) {
      if (
        request !== activePetRequest.current ||
        activePetMutation.current !== DEFAULT_ACTIVE_PET_KEY
      ) {
        return;
      }
      setNotice({
        tone: 'error',
        text: `没能换回 Frieren，${previousName} 仍在陪伴你。${errorMessage(error)}`,
      });
    } finally {
      if (
        request === activePetRequest.current &&
        activePetMutation.current === DEFAULT_ACTIVE_PET_KEY
      ) {
        activePetMutation.current = null;
        setSwitchingKey(null);
      }
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
            <span className="sr-only">
              {localMode ? '搜索我的伙伴' : '搜索名字、描述或作者'}
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={
                localMode ? '搜索我的伙伴' : '搜索名字、描述或作者'
              }
              disabled={!localMode && directSourceId === null}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ F</kbd>
          </label>
          {localMode ? (
            <button
              className="library-import-button"
              type="button"
              disabled={!isTauri || importing}
              onClick={() => void importLocal()}
            >
              {importing ? '正在导入…' : '导入宠物'}
            </button>
          ) : (
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
          )}
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

        {localMode ? (
          <>
            <section
              className="library-catalog library-catalog--local"
              aria-label="我的伙伴与使用历史"
            >
              <div className="library-catalog__heading">
                <div>
                  <h2>我的伙伴</h2>
                  <p>
                    {installedLoading
                      ? '正在读取本地记录'
                      : `${localHistory.length.toLocaleString('zh-CN')} 只 · 最近使用优先`}
                  </p>
                </div>
                <span>不依赖商店</span>
              </div>

              {installedLoading ? (
                <LibraryLoading label="正在翻阅本地伙伴记录…" />
              ) : localHistory.length === 0 ? (
                <LocalLibraryEmpty
                  hasQuery={query.trim() !== ''}
                  importing={importing}
                  importAvailable={isTauri}
                  onImport={() => void importLocal()}
                />
              ) : (
                <div className="library-catalog__scroll">
                  <ol className="library-pet-list">
                    {localHistory.map((pet) => {
                      const itemKey = libraryPetKey(pet.source, pet.slug);
                      const current =
                        activePet !== null &&
                        activePetMatchesInstalled(
                          activePet.reference,
                          pet.source,
                          pet.slug,
                        );
                      const switching =
                        switchingKey === itemKey ||
                        (restoringDefault && current);
                      return (
                        <li key={itemKey}>
                          <button
                            className={[
                              'library-pet-row',
                              selectedLocalPet &&
                              libraryPetKey(
                                selectedLocalPet.source,
                                selectedLocalPet.slug,
                              ) === itemKey
                                ? 'is-selected'
                                : '',
                              current ? 'is-current' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            type="button"
                            aria-pressed={
                              selectedLocalPet !== null &&
                              libraryPetKey(
                                selectedLocalPet.source,
                                selectedLocalPet.slug,
                              ) === itemKey
                            }
                            onClick={() => setSelectedLocalKey(itemKey)}
                          >
                            <PetPreview
                              id={pet.slug}
                              name={pet.displayName}
                              source={pet.source}
                              localSrc={installedSpriteUrl(pet)}
                              localSpriteVersionNumber={pet.spriteVersionNumber}
                              size={68}
                            />
                            <span className="library-pet-row__copy">
                              <strong>{pet.displayName}</strong>
                              <span>{installedPetSourceLabel(pet.source)}</span>
                              <small>{historyLabel(pet)}</small>
                            </span>
                            <span
                              className={
                                switching
                                  ? 'library-pet-row__state is-working'
                                  : current
                                    ? 'library-pet-row__state is-current'
                                    : 'library-pet-row__state'
                              }
                            >
                              {switching
                                ? '切换中'
                                : current
                                  ? '正在陪伴'
                                  : pet.lastUsedAtEpochSeconds
                                    ? `用过 ${pet.useCount} 次`
                                    : '未使用'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </section>

            <section className="library-detail" aria-live="polite">
              {selectedLocalPet ? (
                <LocalPetDetail
                  key={libraryPetKey(
                    selectedLocalPet.source,
                    selectedLocalPet.slug,
                  )}
                  pet={selectedLocalPet}
                  switching={selectedLocalIsSwitching}
                  current={selectedLocalIsActive}
                  activePetLoading={activePetLoading}
                  libraryBusy={
                    importing ||
                    installingKey !== null ||
                    switchingKey !== null
                  }
                  activePetName={activePet?.displayName ?? null}
                  canRestoreDefault={activePet?.reference.kind === 'installed'}
                  restoringDefault={restoringDefault}
                  activationAvailable={isTauri}
                  onActivate={() =>
                    void activateInstalled(selectedLocalPet)
                  }
                  onRestoreDefault={restoreDefault}
                  onOpenSource={
                    selectedLocalPet.sourcePageUrl
                      ? () => void openPage(selectedLocalPet.sourcePageUrl)
                      : undefined
                  }
                />
              ) : (
                <div className="library-detail__empty">
                  <p>导入或收藏一只伙伴后，它会一直留在这里。</p>
                </div>
              )}
            </section>
          </>
        ) : directSourceId !== null ? (
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
                      const current =
                        activePet !== null &&
                        activePetMatchesInstalled(
                          activePet.reference,
                          directSourceId,
                          item.slug,
                        );
                      const switching =
                        switchingKey === itemKey ||
                        (restoringDefault && current);
                      const rowClasses = [
                        'library-pet-row',
                        selectedItem?.slug === item.slug
                          ? 'is-selected'
                          : '',
                        current ? 'is-current' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <li key={itemKey}>
                          <button
                            className={rowClasses}
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
                                installing || switching
                                  ? 'library-pet-row__state is-working'
                                  : current
                                    ? 'library-pet-row__state is-current'
                                  : 'library-pet-row__state'
                              }
                            >
                              {installing
                                ? '检查中'
                                : switching
                                  ? '切换中'
                                  : current
                                    ? '正在陪伴'
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
                  switching={selectedIsSwitching}
                  current={selectedIsActive}
                  activePetLoading={activePetLoading}
                  libraryBusy={
                    installingKey !== null || switchingKey !== null
                  }
                  activePetName={activePet?.displayName ?? null}
                  canRestoreDefault={
                    activePet?.reference.kind === 'installed'
                  }
                  restoringDefault={restoringDefault}
                  installAvailable={isTauri}
                  onInstall={installSelected}
                  onActivate={activateSelected}
                  onRestoreDefault={restoreDefault}
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
            importing={importing}
            importAvailable={isTauri}
            onImport={() => void importLocal()}
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
          role={visibleNotice?.tone === 'error' ? 'alert' : 'status'}
        >
          {visibleNotice?.text ??
            (localMode
              ? '商店下架或离线不会影响这里的本地伙伴。'
              : '收藏不会自动换走当前伙伴；你可以在详情里决定谁来陪伴。')}
        </p>
      </footer>
    </main>
  );
}

interface LocalPetDetailProps {
  pet: InstalledPet;
  switching: boolean;
  current: boolean;
  activePetLoading: boolean;
  libraryBusy: boolean;
  activePetName: string | null;
  canRestoreDefault: boolean;
  restoringDefault: boolean;
  activationAvailable: boolean;
  onActivate: () => void;
  onRestoreDefault: () => void;
  onOpenSource?: () => void;
}

function LocalPetDetail({
  pet,
  switching,
  current,
  activePetLoading,
  libraryBusy,
  activePetName,
  canRestoreDefault,
  restoringDefault,
  activationAvailable,
  onActivate,
  onRestoreDefault,
  onOpenSource,
}: LocalPetDetailProps) {
  return (
    <div className="library-detail__content">
      <div className="library-preview-stage">
        <PetPreview
          id={pet.slug}
          name={pet.displayName}
          source={pet.source}
          localSrc={installedSpriteUrl(pet)}
          localSpriteVersionNumber={pet.spriteVersionNumber}
          size={210}
          animate
          eager
        />
        {switching ? (
          <span className="library-preview-stamp is-working">正在切换</span>
        ) : current ? (
          <span className="library-preview-stamp is-current">当前伙伴</span>
        ) : (
          <span className="library-preview-stamp">本地可用</span>
        )}
      </div>

      <div className="library-detail__title">
        <h2>{pet.displayName}</h2>
        <p>{shortLocalId(pet.slug)}</p>
      </div>

      {pet.description ? (
        <p className="library-detail__description">{pet.description}</p>
      ) : null}

      <dl className="library-detail__facts">
        <div>
          <dt>来源</dt>
          <dd>{installedPetSourceLabel(pet.source)}</dd>
        </div>
        <div>
          <dt>收藏于</dt>
          <dd>{formatHistoryTime(pet.installedAtEpochSeconds)}</dd>
        </div>
        <div>
          <dt>最近使用</dt>
          <dd>
            {pet.lastUsedAtEpochSeconds
              ? `${formatHistoryTime(pet.lastUsedAtEpochSeconds)} · 共 ${pet.useCount} 次`
              : '还没有设为桌面伙伴'}
          </dd>
        </div>
      </dl>

      <div className="library-detail__statuses" aria-label="本地伙伴状态">
        <span>本地可恢复</span>
        <span>格式已校验</span>
      </div>

      <button
        className={[
          'library-install-button',
          switching ? 'is-working' : '',
          current ? 'is-current' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        type="button"
        disabled={
          current ||
          switching ||
          libraryBusy ||
          activePetLoading ||
          !activationAvailable
        }
        onClick={onActivate}
      >
        {switching
          ? restoringDefault
            ? '正在换回默认伙伴…'
            : '正在请它来到桌面…'
          : current
            ? '正在陪伴'
            : libraryBusy
              ? '正在处理另一只伙伴…'
              : activePetLoading
                ? '正在确认当前伙伴…'
                : activationAvailable
                  ? '设为当前伙伴'
                  : '桌面版可更换伙伴'}
      </button>
      {switching ? (
        <div className="library-install-progress" aria-hidden="true">
          <span />
        </div>
      ) : null}
      {canRestoreDefault ? (
        <div className="library-active-companion">
          <p>
            <span>当前伙伴</span>
            <strong>{activePetName}</strong>
          </p>
          <button
            type="button"
            disabled={libraryBusy || activePetLoading}
            onClick={onRestoreDefault}
          >
            {restoringDefault
              ? '正在请 Frieren 回来…'
              : '换回 Frieren（默认伙伴）'}
          </button>
        </div>
      ) : null}
      {onOpenSource ? (
        <button
          className="library-source-link"
          type="button"
          onClick={onOpenSource}
        >
          查看原始来源 <span aria-hidden="true">↗</span>
        </button>
      ) : null}

      <p className="library-safety-note">
        <span aria-hidden="true">◆</span>
        伙伴保存在本机；即使远端目录下架或离线，也可以从这里再次使用。
      </p>
      <p className="library-rights-note">
        {pet.source === 'imported'
          ? '导入只会复制并校验 pet.json 与同目录图集，不会执行脚本。请自行确认素材使用权。'
          : '本地收藏不等于获得角色素材的再分发、公开展示或商用授权。'}
      </p>
    </div>
  );
}

function LocalLibraryEmpty({
  hasQuery,
  importing,
  importAvailable,
  onImport,
}: {
  hasQuery: boolean;
  importing: boolean;
  importAvailable: boolean;
  onImport: () => void;
}) {
  return (
    <div className="library-empty library-empty--local">
      <span aria-hidden="true">◇</span>
      <h3>{hasQuery ? '没有找到本地伙伴' : '把下载的伙伴带回 PetX'}</h3>
      <p>
        {hasQuery
          ? '换个名字、来源或描述再找找。'
          : '选择解压后宠物文件夹里的 pet.json；图集会在本机校验后复制进宠物库。'}
      </p>
      {!hasQuery ? (
        <button
          type="button"
          disabled={!importAvailable || importing}
          onClick={onImport}
        >
          {importing ? '正在导入…' : '选择 pet.json'}
        </button>
      ) : null}
    </div>
  );
}

interface PetDetailProps {
  item: CatalogItem;
  sourceId: DirectLibrarySourceId;
  installed?: InstalledPet;
  installing: boolean;
  switching: boolean;
  current: boolean;
  activePetLoading: boolean;
  libraryBusy: boolean;
  activePetName: string | null;
  canRestoreDefault: boolean;
  restoringDefault: boolean;
  installAvailable: boolean;
  onInstall: () => void;
  onActivate: () => void;
  onRestoreDefault: () => void;
  onOpenSource: () => void;
}

function PetDetail({
  item,
  sourceId,
  installed,
  installing,
  switching,
  current,
  activePetLoading,
  libraryBusy,
  activePetName,
  canRestoreDefault,
  restoringDefault,
  installAvailable,
  onInstall,
  onActivate,
  onRestoreDefault,
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
        {switching ? (
          <span className="library-preview-stamp is-working">正在切换</span>
        ) : current ? (
          <span className="library-preview-stamp is-current">当前伙伴</span>
        ) : installed ? (
          <span className="library-preview-stamp">本地收藏</span>
        ) : null}
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
        className={[
          'library-install-button',
          switching ? 'is-working' : '',
          current ? 'is-current' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        type="button"
        disabled={
          current ||
          libraryBusy ||
          installing ||
          !installAvailable ||
          (Boolean(installed) && activePetLoading) ||
          previewState !== 'ready'
        }
        onClick={installed ? onActivate : onInstall}
      >
        {installing
          ? '正在检查并收进宠物库…'
          : switching
            ? restoringDefault
              ? '正在换回默认伙伴…'
              : '正在请它来到桌面…'
            : current
              ? '正在陪伴'
            : libraryBusy
              ? '正在处理另一只伙伴…'
            : installed && activePetLoading
              ? '正在确认当前伙伴…'
            : !installAvailable
              ? installed
                ? '桌面版可更换伙伴'
                : '桌面版可收藏'
              : previewState === 'failed'
                ? '预览不可用'
                : previewState === 'loading'
                  ? '正在准备预览…'
                  : installed
                    ? '设为当前伙伴'
                    : '收进宠物库'}
      </button>
      {installing || switching ? (
        <div className="library-install-progress" aria-hidden="true">
          <span />
        </div>
      ) : null}
      {canRestoreDefault ? (
        <div className="library-active-companion">
          <p>
            <span>当前伙伴</span>
            <strong>{activePetName}</strong>
          </p>
          <button
            type="button"
            disabled={libraryBusy || activePetLoading}
            onClick={onRestoreDefault}
          >
            {restoringDefault
              ? '正在请 Frieren 回来…'
              : '换回 Frieren（默认伙伴）'}
          </button>
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
  importing,
  importAvailable,
  onImport,
}: {
  sourceId: LibrarySourceId;
  onOpen: () => void;
  importing: boolean;
  importAvailable: boolean;
  onImport: () => void;
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
        <div className="library-external__actions">
          <button type="button" onClick={onOpen}>
            在 {source.name} 浏览 <span aria-hidden="true">↗</span>
          </button>
          <button
            className="is-secondary"
            type="button"
            disabled={!importAvailable || importing}
            onClick={onImport}
          >
            {importing ? '正在导入…' : '导入已下载的宠物'}
          </button>
        </div>
      </div>
      <aside>
        <p>为什么不直接下载？</p>
        <strong>平台负责账号、许可或购买流程。</strong>
        <span>
          PetX 不会绕过这些限制。取得兼容包后，解压并选择其中的
          pet.json 即可导入。
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

function historyLabel(pet: InstalledPet) {
  return pet.lastUsedAtEpochSeconds
    ? `最近使用 ${formatHistoryTime(pet.lastUsedAtEpochSeconds)}`
    : `收藏于 ${formatHistoryTime(pet.installedAtEpochSeconds)}`;
}

function formatHistoryTime(epochSeconds: number) {
  const date = new Date(epochSeconds * 1_000);
  if (!Number.isFinite(epochSeconds) || Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortLocalId(slug: string) {
  return slug.startsWith('local-') ? `本地 ${slug.slice(6, 14)}` : slug;
}

function catalogStatus(
  catalog: CatalogResponse | null,
  sourceId: LibrarySourceId,
) {
  if (sourceId === 'local') {
    return '本地伙伴与使用历史';
  }
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
