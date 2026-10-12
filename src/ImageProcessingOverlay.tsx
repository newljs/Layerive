import { useEffect, useState, type CSSProperties } from 'react';
import type { GenerationTask, TextSegment } from './types';
import type { TaskKind } from './plugins/types';

export type ProcessingTarget = {
  imageId: string | null;
  region?: TextSegment['rect'];
  size?: string;
};

export type ActiveImageTask = {
  id: string | null;
  kind: TaskKind;
  stage?: GenerationTask['stage'];
  target?: ProcessingTarget;
};

export function ImageProcessingOverlay({ effect, region, delay = 200 }: {
  effect: 'scan' | 'shimmer' | 'pulse';
  region?: TextSegment['rect'];
  delay?: number;
}) {
  const [visible, setVisible] = useState(delay === 0);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  if (!visible) return null;
  const style: CSSProperties | undefined = region ? {
    left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%`,
  } : undefined;
  return <div className={`image-processing-overlay effect-${effect}${region ? ' has-region' : ''}`} style={style} aria-hidden="true">
    <div className="processing-tint" />
    <div className="processing-motion"><div className="processing-light" /></div>
    <div className="processing-border" />
  </div>;
}
