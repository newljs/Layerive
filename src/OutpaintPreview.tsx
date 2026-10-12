import { useLayoutEffect, useRef, useState } from 'react';
import { ImageProcessingOverlay } from './ImageProcessingOverlay';
import type { ProjectImage, TextSegment } from './types';

// This is a proportional preview of the requested canvas, not a guarantee of
// where the image model will place each pixel in its output.
export function OutpaintPreview({ image, size, zoom, busy, effect, alt, label }: {
  image: ProjectImage; size: string; zoom: number; busy: boolean;
  effect: 'scan' | 'shimmer' | 'pulse'; alt: string; label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [width, height] = size.split('x').map(Number);
  const sourceWidth = image.width || width;
  const sourceHeight = image.height || height;
  const scale = Math.min(1, width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale / width * 100;
  const h = sourceHeight * scale / height * 100;
  const x = (100 - w) / 2;
  const y = (100 - h) / 2;
  const regions: TextSegment['rect'][] = [
    { x: 0, y: 0, width: 100, height: y },
    { x: 0, y: y + h, width: 100, height: y },
    { x: 0, y, width: x, height: h },
    { x: x + w, y, width: x, height: h },
  ];

  useLayoutEffect(() => {
    const stage = element.current?.closest<HTMLElement>('.canvas-stage');
    if (!stage) return;
    let frame = 0;
    let nextFrame = 0;
    let entering = false;
    const measure = () => {
      const style = getComputedStyle(stage);
      const availableWidth = Math.max(40, stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20);
      const availableHeight = Math.max(40, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 20 - (busy ? 40 : 0));
      const fit = (ratio: number) => {
        const fittedWidth = Math.min(680, availableWidth, availableHeight * ratio);
        return { width: fittedWidth * zoom, height: fittedWidth / ratio * zoom };
      };
      const target = fit(width / height);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      if (!initialized.current) {
        initialized.current = true;
        entering = true;
        setDimensions(fit(sourceWidth / sourceHeight));
        frame = requestAnimationFrame(() => {
          nextFrame = requestAnimationFrame(() => {
            entering = false;
            setExpanded(true);
            setDimensions(target);
          });
        });
      } else { setExpanded(true); setDimensions(target); }
    };
    measure();
    const observer = new ResizeObserver(() => { if (!entering) measure(); });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
    };
  }, [width, height, sourceWidth, sourceHeight, zoom, busy]);

  return <div ref={element} className={`outpaint-preview ${expanded ? 'is-expanded' : ''}`} style={dimensions || { width: 350, aspectRatio: sourceWidth / sourceHeight }} aria-busy={busy}>
    {busy && regions.map((region, index) => region && region.width > 0.01 && region.height > 0.01
      ? <ImageProcessingOverlay key={`${image.id}:${index}`} effect={effect} region={region} /> : null)}
    <div className="outpaint-source" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}>
      <img src={image.url} alt={alt} />
    </div>
    <span>{label}</span>
  </div>;
}
