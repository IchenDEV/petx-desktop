import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PET_MANIFEST_URL,
  DEFAULT_ACTIVE_PET,
  activePetDisplayDescriptor,
  activePetKey,
  activePetMatchesInstalled,
  isSameActivePetReference,
  parseResolvedActivePet,
  type ActivePetRef,
  type ResolvedActivePet,
} from './model';

describe('active pet identity', () => {
  it('uses Frieren as the validated built-in default', () => {
    expect(parseResolvedActivePet(DEFAULT_ACTIVE_PET)).toEqual({
      reference: { kind: 'builtin', id: 'frieren' },
      id: 'frieren',
      displayName: 'Frieren',
      description: 'A quiet white-haired desktop companion.',
      spriteVersionNumber: 2,
      spritePath: null,
      manifestUrl: BUILTIN_PET_MANIFEST_URL,
    });
    expect(activePetKey(DEFAULT_ACTIVE_PET.reference)).toBe(
      'builtin:frieren',
    );
    expect(activePetDisplayDescriptor(DEFAULT_ACTIVE_PET)).toEqual({
      displayName: 'Frieren',
      sourceLabel: '内置伙伴',
    });
  });

  it('keeps the same slug from Petdex and PetShare distinct', () => {
    const petdex: ActivePetRef = {
      kind: 'installed',
      source: 'petdex',
      slug: 'paperclip',
    };
    const petshare: ActivePetRef = {
      kind: 'installed',
      source: 'petshare',
      slug: 'paperclip',
    };

    expect(activePetKey(petdex)).toBe('petdex:paperclip');
    expect(activePetKey(petshare)).toBe('petshare:paperclip');
    expect(isSameActivePetReference(petdex, petshare)).toBe(false);
    expect(activePetMatchesInstalled(petdex, 'petdex', 'paperclip')).toBe(
      true,
    );
    expect(activePetMatchesInstalled(petdex, 'petshare', 'paperclip')).toBe(
      false,
    );
  });

  it('preserves the resolved descriptor for display', () => {
    const paperclip: ResolvedActivePet = {
      reference: {
        kind: 'installed',
        source: 'petshare',
        slug: 'paperclip',
      },
      id: 'paperclip',
      displayName: 'Paperclip',
      description: 'A tiny office companion.',
      spriteVersionNumber: 2,
      spritePath: '/tmp/pets/paperclip/spritesheet.webp',
      manifestUrl: null,
    };

    expect(parseResolvedActivePet(paperclip)).toEqual(paperclip);
    expect(activePetDisplayDescriptor(paperclip)).toEqual({
      displayName: 'Paperclip',
      sourceLabel: 'PetShare',
    });
  });

  it.each([
    null,
    {},
    {
      ...DEFAULT_ACTIVE_PET,
      reference: { kind: 'builtin', id: 'other' },
    },
    {
      ...DEFAULT_ACTIVE_PET,
      spritePath: '/tmp/unexpected.webp',
    },
    {
      ...DEFAULT_ACTIVE_PET,
      manifestUrl: '/pets/other/pet.json',
    },
    {
      ...DEFAULT_ACTIVE_PET,
      spriteVersionNumber: 3,
    },
    {
      reference: {
        kind: 'installed',
        source: 'github',
        slug: 'paperclip',
      },
      id: 'paperclip',
      displayName: 'Paperclip',
      description: null,
      spriteVersionNumber: 2,
      spritePath: '/tmp/paperclip.webp',
      manifestUrl: null,
    },
    {
      reference: {
        kind: 'installed',
        source: 'petdex',
        slug: '../paperclip',
      },
      id: '../paperclip',
      displayName: 'Paperclip',
      description: null,
      spriteVersionNumber: 2,
      spritePath: '/tmp/paperclip.webp',
      manifestUrl: null,
    },
    {
      reference: {
        kind: 'installed',
        source: 'petdex',
        slug: 'paperclip',
      },
      id: 'different-id',
      displayName: 'Paperclip',
      description: null,
      spriteVersionNumber: 2,
      spritePath: '/tmp/paperclip.webp',
      manifestUrl: null,
    },
    {
      reference: {
        kind: 'installed',
        source: 'petdex',
        slug: 'paperclip',
      },
      id: 'paperclip',
      displayName: 'Paperclip',
      description: null,
      spriteVersionNumber: 2,
      spritePath: null,
      manifestUrl: null,
    },
  ])('rejects malformed native descriptors', (value) => {
    expect(() => parseResolvedActivePet(value)).toThrow(
      '当前伙伴数据无法识别。',
    );
  });
});
