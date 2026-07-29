import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { Menu } from '@tauri-apps/api/menu';
import { currentMonitor, getCurrentWindow, Window } from '@tauri-apps/api/window';

export const isTauri = '__TAURI_INTERNALS__' in window;

export type WindowRole = 'main' | 'settings' | 'library';
export type CompanionSurface =
  | 'resting'
  | 'bubble'
  | 'care'
  | 'journal'
  | 'context';

const companionSizes: Record<CompanionSurface, LogicalSize> = {
  resting: new LogicalSize(248, 276),
  bubble: new LogicalSize(448, 356),
  care: new LogicalSize(500, 356),
  journal: new LogicalSize(620, 470),
  context: new LogicalSize(390, 360),
};

let positionedInitialWindow = false;
let resizeQueue: Promise<void> = Promise.resolve();

export function getWindowRole(): WindowRole {
  const role = isTauri
    ? getCurrentWindow().label
    : new URLSearchParams(window.location.search).get('view');
  return role === 'settings' || role === 'library' ? role : 'main';
}

export function getPreviewSurface(): CompanionSurface | null {
  if (isTauri || !import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get('preview');
  return value === 'bubble' ||
    value === 'care' ||
    value === 'journal' ||
    value === 'context'
    ? value
    : null;
}

async function fitCompanionWindow(surface: CompanionSurface) {
  if (!isTauri) return;

  const appWindow = getCurrentWindow();
  if (appWindow.label !== 'main') return;
  const nextSize = companionSizes[surface];

  if (!positionedInitialWindow) {
    positionedInitialWindow = true;
    await appWindow.setSize(nextSize);
    const monitor = await currentMonitor();
    const outerSize = await appWindow.outerSize();
    if (!monitor) return;
    const margin = Math.round(18 * monitor.scaleFactor);
    await appWindow.setPosition(
      new PhysicalPosition(
        monitor.position.x + monitor.size.width - outerSize.width - margin,
        monitor.position.y + monitor.size.height - outerSize.height - margin,
      ),
    );
    return;
  }

  const currentPosition = await appWindow.outerPosition();
  const currentSize = await appWindow.outerSize();
  const petAnchor = {
    x: currentPosition.x + currentSize.width,
    y: currentPosition.y + currentSize.height,
  };

  await appWindow.setSize(nextSize);
  const resizedWindow = await appWindow.outerSize();
  await appWindow.setPosition(
    new PhysicalPosition(
      petAnchor.x - resizedWindow.width,
      petAnchor.y - resizedWindow.height,
    ),
  );
}

export function scheduleCompanionWindowFit(surface: CompanionSurface) {
  resizeQueue = resizeQueue
    .then(() => fitCompanionWindow(surface))
    .catch((error: unknown) => console.error('Unable to resize the companion window', error));
}

export async function startCompanionDrag() {
  if (isTauri) await getCurrentWindow().startDragging();
}

export async function setCompanionAlwaysOnTop(alwaysOnTop: boolean) {
  if (!isTauri) return;
  await invoke('set_main_always_on_top', { alwaysOnTop });
}

export async function showSettingsWindow() {
  if (!isTauri) {
    window.open(`${window.location.pathname}?view=settings`, 'petx-settings');
    return;
  }

  const settingsWindow = await Window.getByLabel('settings');
  if (!settingsWindow) return;
  await settingsWindow.show();
  await settingsWindow.unminimize();
  await settingsWindow.setFocus();
}

export async function showLibraryWindow() {
  if (!isTauri) {
    window.open(`${window.location.pathname}?view=library`, 'petx-library');
    return;
  }

  const libraryWindow = await Window.getByLabel('library');
  if (!libraryWindow) return;
  await libraryWindow.show();
  await libraryWindow.unminimize();
  await libraryWindow.setFocus();
}

export async function hideCompanion() {
  if (isTauri) await getCurrentWindow().hide();
}

export async function quietCompanionForOneHour() {
  if (isTauri) {
    await invoke('quiet_for_one_hour');
  }
}

export async function quitApplication() {
  if (!isTauri) {
    window.close();
    return;
  }

  await invoke('quit_app');
}

export async function notifyMainWindow(event: string, payload?: unknown) {
  if (!isTauri) return;
  const mainWindow = await Window.getByLabel('main');
  await mainWindow?.emit(event, payload);
}

export interface CompanionMenuActions {
  openCare: () => void;
  openLibrary: () => void;
  openJournal: () => void;
  quietForOneHour: () => void;
  openSettings: () => void;
  hide: () => void;
  quit: () => void;
}

export async function showCompanionContextMenu(
  actions: CompanionMenuActions,
) {
  if (!isTauri) return false;

  const menu = await Menu.new({
    items: [
      {
        id: 'open-care',
        text: '照料一下…',
        action: actions.openCare,
      },
      {
        id: 'open-library',
        text: '发现新伙伴…',
        action: actions.openLibrary,
      },
      {
        id: 'open-journal',
        text: '打开纪念册',
        action: actions.openJournal,
      },
      {
        id: 'quiet-one-hour',
        text: '安静一小时',
        action: actions.quietForOneHour,
      },
      { item: 'Separator' },
      {
        id: 'open-settings',
        text: '设置…',
        action: actions.openSettings,
      },
      {
        id: 'hide-pet',
        text: '隐藏宠物',
        action: actions.hide,
      },
      { item: 'Separator' },
      {
        id: 'quit-petx',
        text: '退出 PetX',
        action: actions.quit,
      },
    ],
  });

  await menu.popup(undefined, getCurrentWindow());
  return true;
}
