import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
  listen: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock('../platform', () => ({ isTauri: true }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: native.convertFileSrc,
  invoke: native.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));

import {
  ACTIVE_PET_CHANGED_EVENT,
  listenToActivePetChanges,
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
});
