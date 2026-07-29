import { describe, expect, it } from 'vitest';
import { createActivePetPresentation } from './activePetPresentation';
import type { ResolvedActivePet } from '../library/model';

describe('active pet companion presentation', () => {
  it('uses an installed pet for rendering and its isolated relationship profile', () => {
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

    expect(createActivePetPresentation(paperclip)).toEqual({
      profileKey: 'petdex:paperclip',
      profileStorageKey:
        'petx-desktop:companion-state:profile:petdex%3Apaperclip',
      manifest: {
        id: 'paperclip',
        displayName: 'Paperclip',
        description: 'A tiny office companion.',
        spriteVersionNumber: 1,
        spritesheetPath: 'spritesheet.png',
      },
    });
  });

  it('keeps identical slugs from different sources in different profiles', () => {
    const petshare: ResolvedActivePet = {
      reference: {
        kind: 'installed',
        source: 'petshare',
        slug: 'paperclip',
      },
      id: 'paperclip',
      displayName: 'Paperclip',
      description: null,
      spriteVersionNumber: 2,
      spritePath: '/pets/petshare--paperclip/spritesheet.webp',
      manifestUrl: null,
    };

    expect(createActivePetPresentation(petshare)).toMatchObject({
      profileKey: 'petshare:paperclip',
      profileStorageKey:
        'petx-desktop:companion-state:profile:petshare%3Apaperclip',
      manifest: {
        id: 'paperclip',
        displayName: 'Paperclip',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.webp',
      },
    });
  });
});
