import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useLanguage } from './i18n';
import { thumbUrl } from './api';
import type { ProjectImage } from './types';

export function CompareImagePicker({ images, selectedId, onSelect }: { images: ProjectImage[]; selectedId: string; onSelect: (id: string) => void }) {
  const { t } = useLanguage();
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });

  function reveal(item: HTMLElement) {
    const viewport = viewportRef.current!;
    const bounds = viewport.getBoundingClientRect();
    const target = item.getBoundingClientRect();
    if (target.left < bounds.left + 12) viewport.scrollBy({ left: target.left - bounds.left - 12, behavior: 'instant' });
    else if (target.right > bounds.right - 12) viewport.scrollBy({ left: target.right - bounds.right + 12, behavior: 'instant' });
  }

  useLayoutEffect(() => {
    const shell = shellRef.current!;
    const viewport = viewportRef.current!;
    const track = trackRef.current!;
    const update = () => {
      const overflow = track.scrollWidth > shell.clientWidth + 1;
      const next = { overflow, left: overflow && viewport.scrollLeft > 1, right: overflow && viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1 };
      setEdges(previous => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = delta * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? viewport.clientWidth : 1);
      const destination = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + pixels));
      if (Math.abs(destination - viewport.scrollLeft) < 0.5) return;
      event.preventDefault();
      viewport.scrollLeft = destination;
    };
    const observer = new ResizeObserver(() => {
      update();
      const selected = track.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (selected) reveal(selected);
    });
    observer.observe(shell);
    observer.observe(viewport);
    observer.observe(track);
    viewport.addEventListener('scroll', update, { passive: true });
    viewport.addEventListener('wheel', wheel, { passive: false });
    update();
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', update); viewport.removeEventListener('wheel', wheel); };
  }, []);

  useLayoutEffect(() => {
    const selected = trackRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected) reveal(selected);
  }, [selectedId, images.length]);

  const scroll = (direction: number) => viewportRef.current!.scrollBy({
    left: direction * Math.max(120, viewportRef.current!.clientWidth * 0.75),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });

  return <div className="compare-picker">
    <span>{t('ws.pickCompare')}</span>
    <div ref={shellRef} className={`compare-picker-shell${edges.overflow ? ' has-overflow' : ''}`}>
      <button type="button" className="compare-picker-arrow" hidden={!edges.overflow} disabled={!edges.left} aria-label={t('ws.compareScrollLeft')} onClick={() => scroll(-1)}><Icon name="left" size={17} /></button>
      <div ref={viewportRef} className="compare-picker-viewport" data-scroll-left={edges.left} data-scroll-right={edges.right} role="group" aria-label={t('ws.pickCompare')} onFocusCapture={event => { if (event.target instanceof HTMLElement) reveal(event.target); }} onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...trackRef.current!.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
        buttons[next]?.focus({ preventScroll: true });
      }}>
        <div ref={trackRef} className="compare-picker-track">{images.map((image, index) => <button type="button" key={image.id} className={`compare-picker-item${image.id === selectedId ? ' active' : ''}`} aria-pressed={image.id === selectedId} aria-label={t('ws.compareImageNumber', { index: index + 1 })} onClick={() => onSelect(image.id)}><img src={thumbUrl(image)} alt="" loading="lazy" /></button>)}</div>
      </div>
      <button type="button" className="compare-picker-arrow" hidden={!edges.overflow} disabled={!edges.right} aria-label={t('ws.compareScrollRight')} onClick={() => scroll(1)}><Icon name="left" size={17} style={{ transform: 'rotate(180deg)' }} /></button>
    </div>
  </div>;
}
