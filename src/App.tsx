import { useCallback, useEffect, useState } from 'react';
import { PetX } from '@petx/react';
import type { CodexPetManifest } from '@petx/react';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

const petManifest: CodexPetManifest = {
  id: 'frieren',
  displayName: 'Frieren',
  description: 'A tiny Codex digital pet inspired by Frieren, a white-haired elf mage simplified into a compact pixel mascot.',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
};

const animations = [
  { value: 'idle', label: '待机' },
  { value: 'waving', label: '招手' },
  { value: 'runningRight', label: '奔跑' },
  { value: 'jumping', label: '跳跃' },
] as const;

type AnimationName = (typeof animations)[number]['value'];
type Settings = { animation: AnimationName; size: number; alwaysOnTop: boolean };

const defaultSettings: Settings = { animation: 'idle', size: 176, alwaysOnTop: true };
const isTauri = '__TAURI_INTERNALS__' in window;
let hasPositionedInitialWindow = false;
let windowFitQueue: Promise<void> = Promise.resolve();

function readSettings(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem('petx-desktop:settings') ?? 'null') as Partial<Settings> | null;
    return value ? { ...defaultSettings, ...value } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

async function fitWindow(panelOpen: boolean) {
  if (!isTauri) return;
  const appWindow = getCurrentWindow();
  const nextSize = panelOpen ? new LogicalSize(600, 460) : new LogicalSize(248, 276);

  if (!hasPositionedInitialWindow) {
    hasPositionedInitialWindow = true;
    await appWindow.setSize(nextSize);
    const monitor = await currentMonitor();
    const outerSize = await appWindow.outerSize();
    if (!monitor) return;
    const margin = Math.round(20 * monitor.scaleFactor);
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

function scheduleWindowFit(panelOpen: boolean) {
  windowFitQueue = windowFitQueue
    .then(() => fitWindow(panelOpen))
    .catch((error: unknown) => console.error('Unable to resize the companion window', error));
}

export function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [panelOpen, setPanelOpen] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [autostartAvailable, setAutostartAvailable] = useState(isTauri);

  useEffect(() => {
    document.body.classList.toggle('browser-preview', !isTauri);
    scheduleWindowFit(panelOpen);
  }, [panelOpen]);

  useEffect(() => {
    localStorage.setItem('petx-desktop:settings', JSON.stringify(settings));
    if (isTauri) void getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop);
  }, [settings]);

  useEffect(() => {
    if (!isTauri) return;
    isEnabled().then(setLaunchAtLogin).catch(() => setAutostartAvailable(false));
  }, []);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const toggleAutostart = async () => {
    const next = !launchAtLogin;
    setLaunchAtLogin(next);
    try {
      await (next ? enable() : disable());
    } catch {
      setLaunchAtLogin(!next);
      setAutostartAvailable(false);
    }
  };

  const startDrag = async () => {
    if (isTauri) await getCurrentWindow().startDragging();
  };

  const closeApp = async () => {
    if (isTauri) await getCurrentWindow().close();
  };

  return (
    <main className={panelOpen ? 'companion companion--open' : 'companion'}>
      {panelOpen ? (
        <section className="control-panel" aria-label="宠物设置">
          <header className="panel-header">
            <div>
              <h1>PetX</h1>
              <p>桌面伙伴</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setPanelOpen(false)} aria-label="收起设置">
              <ChevronIcon />
            </button>
          </header>

          <fieldset>
            <legend>动画</legend>
            <div className="animation-grid">
              {animations.map((item) => (
                <button
                  className={settings.animation === item.value ? 'animation-option is-selected' : 'animation-option'}
                  type="button"
                  key={item.value}
                  onClick={() => update('animation', item.value)}
                  aria-pressed={settings.animation === item.value}
                >
                  <PetX
                    src="/pets/frieren/spritesheet.webp"
                    spriteVersionNumber={2}
                    animation={item.value}
                    size={44}
                    title={`${item.label}动画预览`}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="range-field">
            <span>尺寸</span>
            <output>{settings.size}px</output>
            <input
              type="range"
              min="128"
              max="224"
              step="8"
              value={settings.size}
              onChange={(event) => update('size', Number(event.target.value))}
            />
          </label>

          <div className="toggle-list">
            <Toggle
              label="始终置顶"
              checked={settings.alwaysOnTop}
              onChange={(checked) => update('alwaysOnTop', checked)}
            />
            <Toggle
              label="开机启动"
              checked={launchAtLogin}
              onChange={() => void toggleAutostart()}
              disabled={!autostartAvailable}
            />
          </div>

          <footer className="panel-footer">
            <span>右键宠物可收起设置</span>
            <button type="button" onClick={() => void closeApp()}>退出</button>
          </footer>
        </section>
      ) : null}

      <section className="pet-stage" aria-label="Frieren 桌面宠物">
        <button
          className="pet-button"
          type="button"
          onPointerDown={(event) => {
            if (event.button === 0) void startDrag();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setPanelOpen((open) => !open);
          }}
          onDoubleClick={() => update('animation', 'waving')}
          aria-label="Frieren 桌面宠物；按住拖动，右键打开设置，双击招手"
        >
          <PetX
            pet={petManifest}
            manifestUrl="/pets/frieren/pet.json"
            animation={settings.animation}
            size={settings.size}
            title="Frieren Codex pet"
          />
        </button>
        {!panelOpen ? (
          <button className="settings-button" type="button" onClick={() => setPanelOpen(true)} aria-label="打开宠物设置">
            <SettingsIcon />
          </button>
        ) : null}
      </section>
    </main>
  );
}

function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className={disabled ? 'toggle-row is-disabled' : 'toggle-row'}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.04 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
}
