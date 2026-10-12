import { useEffect, useState, type ImgHTMLAttributes } from 'react';

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
  useEffect(() => {
    if (!keepPrevious) return;
    let canceled = false;
    const image = new Image();
    image.onload = async () => {
      try { await image.decode(); } catch { /* A loaded image can still be displayed. */ }
      if (canceled) return;
      setDisplayed(src);
      setReadySource(src);
    };
    image.onerror = () => {
      if (canceled) return;
      setDisplayed(src);
      setFailedSource(src);
    };
    image.src = src;
    return () => { canceled = true; image.onload = null; image.onerror = null; };
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
