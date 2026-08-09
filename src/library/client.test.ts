import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
  listen: vi.fn(),
  openFile: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('../platform', () => ({ isTauri: true }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: native.convertFileSrc,
  invoke: native.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.openFile }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));

import {
  ACTIVE_PET_CHANGED_EVENT,
  chooseAndImportLocalPet,
  listenToActivePetChanges,
  parsePetdexCatalog,
  resolveActivePetAssets,
  setActivePet,
} from './client';
import type { ResolvedActivePet } from './model';

const paperclip: ResolvedActivePet = {
  reference: {
    kind: 'installed',
    source: 'petdex',
    slug: 'paperclip',
  },
  id: 'paperclip',
  displayName: 'Paperclip',
  description: 'A tiny office companion.',
  spriteVersionNumber: 1,
  spritePath: '/pets/petdex--paperclip/spritesheet.png',
  manifestUrl: null,
};

describe('active pet native bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns an installed library item into the active companion', async () => {
    native.invoke.mockResolvedValueOnce(paperclip);

    await expect(setActivePet('petdex', 'paperclip')).resolves.toEqual(
      paperclip,
    );
    expect(native.invoke).toHaveBeenCalledWith('set_active_pet', {
      source: 'petdex',
      slug: 'paperclip',
    });
    expect(resolveActivePetAssets(paperclip)).toEqual({
      spriteUrl: 'asset:///pets/petdex--paperclip/spritesheet.png',
    });
  });

  it('applies a validated active-pet change event across windows', async () => {
    let deliver: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    native.listen.mockImplementationOnce(
      async (_eventName: string, handler: typeof deliver) => {
        deliver = handler;
        return unlisten;
      },
    );
    const onChange = vi.fn();

    await expect(listenToActivePetChanges(onChange)).resolves.toBe(
      unlisten,
    );
    expect(native.listen).toHaveBeenCalledWith(
      ACTIVE_PET_CHANGED_EVENT,
      expect.any(Function),
    );

    deliver?.({ payload: paperclip });
    expect(onChange).toHaveBeenCalledWith(paperclip);
  });

  it('imports a user-selected pet.json through the validated native command', async () => {
    const imported = {
      source: 'imported',
      slug: 'local-0123456789abcdef',
      displayName: 'My Companion',
      description: null,
      submittedBy: null,
      spritePath: '/pets/imported--local-0123456789abcdef/spritesheet.webp',
      sourcePageUrl: '',
      spriteVersionNumber: 2,
      installedAtEpochSeconds: 100,
      lastUsedAtEpochSeconds: null,
      useCount: 0,
      sha256: 'a'.repeat(64),
    };
    native.openFile.mockResolvedValueOnce('/Downloads/my-pet/pet.json');
    native.invoke.mockResolvedValueOnce(imported);

    await expect(chooseAndImportLocalPet()).resolves.toEqual(imported);
    expect(native.openFile).toHaveBeenCalledWith({
      title: '选择宠物文件夹里的 pet.json',
      multiple: false,
      directory: false,
      filters: [{ name: 'PetX 宠物清单', extensions: ['json'] }],
    });
    expect(native.invoke).toHaveBeenCalledWith('import_local_pet', {
      manifestPath: '/Downloads/my-pet/pet.json',
    });
  });

  it('leaves the library unchanged when the import dialog is cancelled', async () => {
    native.openFile.mockResolvedValueOnce(null);

    await expect(chooseAndImportLocalPet()).resolves.toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('accepts the current Petdex v2 catalog field added in August 2026', () => {
    expect(
      parsePetdexCatalog({
        v: 2,
        generatedAt: '2026-08-09T12:33:27.295Z',
        total: 1,
        assetBase: 'https://assets.petdex.dev',
        fields: [
          'slug',
          'displayName',
          'kind',
          'submittedBy',
          'spritesheet',
          'petJson',
          'zip',
          'spriteVersionNumber',
        ],
        pets: [
          [
            'homelander',
            'Homelander',
            'character',
            'Serhat',
            'pets/homelander-dbbb6a60a484/sprite.webp',
            'pets/homelander-dbbb6a60a484/petjson.json',
            'pets/homelander-dbbb6a60a484/zip.zip',
            1,
          ],
        ],
      }),
    ).toMatchObject({
      total: 1,
      items: [{ slug: 'homelander', displayName: 'Homelander' }],
    });
  });
});
