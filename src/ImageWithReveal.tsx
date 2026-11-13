import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

// How long the previous picture may stay on the canvas while the next one is
// still downloading or decoding. A stuck request must never pin the old picture:
// after this the new source is shown even if it has not reported ready yet.
const REVEAL_TIMEOUT_MS = 1500;

// Keep the last canvas image visible until the next image has loaded and decoded.
// Thumbnails use their native loading mode and only fade after their own load.
export function ImageWithReveal({ src, reveal = true, keepPrevious = false, className = '', onLoad, onError, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  reveal?: boolean;
  keepPrevious?: boolean;
}) {
  const [displayed, setDisplayed] = useState(src);
  const [readySource, setReadySource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  // Sources this component has already decoded once. Re-showing one of them needs
  // no preload round trip, so switching back and forth stays instant.
  const loadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!keepPrevious) return;
    if (loadedRef.current.has(src)) {
      setDisplayed(src);
      setReadySource(src);
      return;
    }
    let canceled = false;
    const show = () => {
      if (canceled) return;
      setDisplayed(src);
    };
    const image = new Image();
    image.onload = async () => {
      try { await image.decode(); } catch { /* A loaded image can still be displayed. */ }
      if (canceled) return;
      loadedRef.current.add(src);
      setDisplayed(src);
      setReadySource(src);
    };
    image.onerror = () => {
      if (canceled) return;
      setDisplayed(src);
      setFailedSource(src);
    };
    image.src = src;
    const timer = window.setTimeout(show, REVEAL_TIMEOUT_MS);
    return () => { canceled = true; window.clearTimeout(timer); image.onload = null; image.onerror = null; };
  }, [src, keepPrevious]);
  const visibleSource = keepPrevious ? displayed : src;
  const ready = readySource === visibleSource;
  const pending = reveal && !ready && failedSource !== visibleSource;
  return <img {...props} key={visibleSource} src={visibleSource} data-image-pending={visibleSource !== src || !ready ? 'true' : undefined}
    className={`${className}${pending ? ' image-reveal-pending' : ''}${ready && reveal ? ' image-reveal-ready' : ''}`.trim()}
    onLoad={async event => {
      const image = event.currentTarget;
      onLoad?.(event);
      if (keepPrevious) return;
      try { await image.decode(); } catch { /* Use the loaded image. */ }
      if (image.isConnected) setReadySource(visibleSource);
    }}
    onError={event => { setFailedSource(visibleSource); onError?.(event); }} />;
}
