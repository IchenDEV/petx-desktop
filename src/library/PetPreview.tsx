import { PetX } from '@petx/react';
import { useEffect, useRef, useState } from 'react';
import {
  fetchPetdexPreview,
  type ResolvedPetPreview,
} from './client';

interface PetPreviewProps {
  id: string;
  name: string;
  localSrc?: string;
  localSpriteVersionNumber?: number;
  petdexSrc?: string;
  petdexManifestSrc?: string;
  size: number;
  animate?: boolean;
  eager?: boolean;
  onReady?: () => void;
  onError?: () => void;
}

export function PetPreview({
  id,
  name,
  localSrc,
  localSpriteVersionNumber = 1,
  petdexSrc,
  petdexManifestSrc,
  size,
  animate = false,
  eager = false,
  onReady,
  onError,
}: PetPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [preview, setPreview] = useState<ResolvedPetPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    const element = containerRef.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setPreview(null);
    setFailed(false);

    if (localSrc) {
      setPreview({
        spriteUrl: localSrc,
        thumbnailUrl: localSrc,
        thumbnailIsSheet: true,
        spriteVersionNumber: localSpriteVersionNumber,
      });
      onReady?.();
      return;
    }
    if (!petdexSrc || !petdexManifestSrc) {
      setFailed(true);
      onError?.();
      return;
    }

    void fetchPetdexPreview(id, petdexSrc, petdexManifestSrc)
      .then((resolved) => {
        if (active) {
          setPreview(resolved);
          onReady?.();
        }
      })
      .catch((error: unknown) => {
        console.error(`Unable to load preview for ${id}`, error);
        if (active) {
          setFailed(true);
          onError?.();
        }
      });
    return () => {
      active = false;
    };
  }, [
    id,
    localSpriteVersionNumber,
    localSrc,
    onError,
    onReady,
    petdexManifestSrc,
    petdexSrc,
    visible,
  ]);

  const frameHeight = Math.round(size * 1.08);

  return (
    <div
      className="library-pet-preview"
      ref={containerRef}
      style={{ width: size, height: frameHeight }}
      aria-label={`${name} 的图集预览`}
    >
      {preview && animate ? (
        <PetX
          src={preview.spriteUrl}
          pet={{
            id,
            displayName: name,
            spriteVersionNumber: preview.spriteVersionNumber,
            spritesheetPath: isPng(preview.spriteUrl)
              ? 'spritesheet.png'
              : 'spritesheet.webp',
          }}
          animation="idle"
          playing={animate}
          frame={animate ? undefined : 0}
          spriteVersionNumber={preview.spriteVersionNumber}
          size={size}
          title={`${name} 预览`}
        />
      ) : preview ? (
        <span
          className={
            preview.thumbnailIsSheet
              ? 'library-pet-thumbnail is-sheet'
              : 'library-pet-thumbnail'
          }
          style={{ width: size, height: frameHeight }}
        >
          <img
            src={preview.thumbnailUrl}
            alt=""
            draggable={false}
            style={
              preview.thumbnailIsSheet
                ? { width: size * 8, maxWidth: 'none' }
                : undefined
            }
            onError={() => {
              setFailed(true);
              onError?.();
            }}
          />
        </span>
      ) : failed ? (
        <span className="library-pet-preview__error">暂无预览</span>
      ) : (
        <span className="library-pet-preview__pending" aria-hidden="true">
          ···
        </span>
      )}
    </div>
  );
}

function isPng(url: string): boolean {
  try {
    return new URL(url, window.location.href).pathname.endsWith('.png');
  } catch {
    return url.endsWith('.png');
  }
}
