import type { CodexPetManifest } from '@petx/react';
import { activePetKey, type ResolvedActivePet } from '../library/model';
import { companionStateStorageKey } from './storage';

export interface ActivePetPresentation {
  profileKey: string;
  profileStorageKey: string;
  manifest: CodexPetManifest;
}

export function createActivePetPresentation(
  activePet: ResolvedActivePet,
): ActivePetPresentation {
  const profileKey = activePetKey(activePet.reference);
  return {
    profileKey,
    profileStorageKey: companionStateStorageKey(profileKey),
    manifest: {
      id: activePet.id,
      displayName: activePet.displayName,
      ...(activePet.description === null
        ? {}
        : { description: activePet.description }),
      spriteVersionNumber: activePet.spriteVersionNumber,
      spritesheetPath: activePet.spritePath?.toLowerCase().endsWith('.png')
        ? 'spritesheet.png'
        : 'spritesheet.webp',
    },
  };
}
