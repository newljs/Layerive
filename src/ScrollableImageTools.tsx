import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useLanguage } from './i18n';

export function ScrollableImageTools({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const shellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });

  useLayoutEffect(() => {
    const shell = shellRef.current!;
    const menu = menuRef.current!;
    const track = trackRef.current!;
    const update = () => {
      // Measure against the full shell so adding arrows cannot keep overflow stuck on.
      const overflow = track.scrollWidth + 8 > shell.clientWidth;
      const next = {
        overflow,
        left: overflow && menu.scrollLeft > 1,
        right: overflow && menu.scrollLeft + menu.clientWidth < menu.scrollWidth - 1,
      };
      setEdges(previous => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || menu.scrollWidth <= menu.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = delta * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? menu.clientWidth : 1);
      const destination = Math.max(0, Math.min(menu.scrollWidth - menu.clientWidth, menu.scrollLeft + pixels));
      // Let the surrounding page scroll when this toolbar has reached the edge.
      if (Math.abs(destination - menu.scrollLeft) < 0.5) return;
      event.preventDefault();
      menu.scrollLeft = destination;
    };
    const resize = new ResizeObserver(update);
    resize.observe(shell);
    resize.observe(menu);
    resize.observe(track);
    menu.addEventListener('scroll', update, { passive: true });
    menu.addEventListener('wheel', onWheel, { passive: false });
    update();
    return () => {
      resize.disconnect();
      menu.removeEventListener('scroll', update);
      menu.removeEventListener('wheel', onWheel);
    };
  }, []);

  const scroll = (direction: number) => {
    const menu = menuRef.current!;
    menu.scrollBy({
      left: direction * Math.max(120, menu.clientWidth * 0.75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return <div ref={shellRef} className={`canvas-edit-toolbar${edges.overflow ? ' has-overflow' : ''}`}>
    <button type="button" className="canvas-tools-scroll" hidden={!edges.overflow} disabled={!edges.left} aria-label={t('ws.toolsScrollLeft')} title={t('ws.toolsScrollLeft')} onClick={() => scroll(-1)}><Icon name="left" size={17} /></button>
    <nav ref={menuRef} className="canvas-edit-menu" aria-label={t('ws.imageEditTools')} data-scroll-left={edges.left} data-scroll-right={edges.right} onFocusCapture={event => {
      const menu = menuRef.current!;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const bounds = menu.getBoundingClientRect();
      const item = target.getBoundingClientRect();
      const inset = 14;
      if (item.left < bounds.left + inset) menu.scrollBy({ left: item.left - bounds.left - inset, behavior: 'instant' });
      else if (item.right > bounds.right - inset) menu.scrollBy({ left: item.right - bounds.right + inset, behavior: 'instant' });
    }} onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...trackRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      buttons[next]?.focus({ preventScroll: true });
    }}>
      <div ref={trackRef} className="canvas-edit-track">{children}</div>
    </nav>
    <button type="button" className="canvas-tools-scroll scroll-right" hidden={!edges.overflow} disabled={!edges.right} aria-label={t('ws.toolsScrollRight')} title={t('ws.toolsScrollRight')} onClick={() => scroll(1)}><Icon name="left" size={17} style={{ transform: 'rotate(180deg)' }} /></button>
  </div>;
}
