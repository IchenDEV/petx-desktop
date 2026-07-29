import type { SoundPreferences } from './model';

let audioContext: AudioContext | null = null;

export function playCompanionChime(
  preferences: SoundPreferences,
  tone: 'soft' | 'bright' = 'soft',
) {
  if (!preferences.enabled || preferences.volume <= 0) return;

  const context = audioContext ?? new AudioContext();
  audioContext = context;
  if (context.state === 'suspended') void context.resume();
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const peak = Math.max(0.008, preferences.volume * 0.12);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(tone === 'bright' ? 740 : 620, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    tone === 'bright' ? 940 : 700,
    now + 0.13,
  );

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.21);
}
