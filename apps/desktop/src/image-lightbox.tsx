import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface LightboxImage {
  readonly src: string;
  readonly alt?: string;
}

type Listener = () => void;

let current: LightboxImage | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function openImageLightbox(image: LightboxImage): void {
  current = image;
  emit();
}

export function closeImageLightbox(): void {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LightboxImage | null {
  return current;
}

export function ImageLightbox() {
  const image = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!image) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeImageLightbox();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [image]);

  if (!image) return null;

  return createPortal(
    <div
      className="image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt ?? "Image viewer"}
      onClick={closeImageLightbox}
    >
      <button
        type="button"
        className="image-lightbox__close"
        aria-label="Close image viewer"
        onClick={(event) => {
          event.stopPropagation();
          closeImageLightbox();
        }}
      >
        ×
      </button>
      <img
        className="image-lightbox__image"
        src={image.src}
        alt={image.alt ?? ""}
        onClick={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
