'use client';

/*
  The five growth stages as a track that ends.

  The ring variant says the journey loops, which is wrong: a roasted bean is the
  last thing that happens to a bean, not the step before another sprout. So this
  one runs left to right and climbs, the drop counts sit under it like the axis of
  a chart, and it stops at a terminal mark it cannot roll past. Swiping at either
  end resists instead of wrapping, which is the whole argument made mechanical.

  A bean rolls along the line. Everything behind it is inked, everything ahead is
  a faint dotted rule, so how far along a stage sits is legible without reading a
  number. Position drives it all from one motion value; React renders on a stage
  change and otherwise stays out of the frame loop.
*/

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { GrowthIcon } from '@/components/cafe/GrowthIcon';
import { CoffeeBean } from '@/shared/ui';

export type TrackStage = {
  title: string;
  badge: string;
  description: string;
};

/* Drops needed for each level, in the order `getGrowthLevel` awards them. */
const DROPS = [1, 3, 5, 10, 15];
const LAST = DROPS.length - 1;
const SNAP = { type: 'spring', stiffness: 180, damping: 26 } as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

type Point = { x: number; y: number };
type Gap = { x1: number; y1: number; x2: number; y2: number };

/*
  One gap's worth of ink, drawn by its own `pathLength`.

  Deliberately not one path with four subpaths: SVG restarts a dash pattern at
  every subpath, so a single offset over the whole track drew a little of all
  four gaps at once instead of filling them in turn.

  `pathLength` rather than a dash array sized in pixels: that array was fixed at the
  first measure, and once the box settled wider (a phone does, as the page lays out)
  the dash no longer matched the line and a stub of ink showed at the far end of
  every gap.
*/
function Ink({ gap, index, at }: { gap: Gap; index: number; at: ReturnType<typeof useMotionValue<number>> }) {
  const progress = useTransform(at, (v) => clamp(v - index, 0, 1));
  // At zero length a round cap still paints a dot, so a gap not yet reached draws nothing.
  const opacity = useTransform(at, (v) => (v > index ? 1 : 0));
  return (
    <motion.line
      x1={gap.x1}
      y1={gap.y1}
      x2={gap.x2}
      y2={gap.y2}
      stroke="var(--brand)"
      strokeWidth={2}
      strokeLinecap="round"
      style={{ pathLength: progress, opacity }}
    />
  );
}

export function GrowthTrack({ stages }: { stages: TrackStage[] }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [panning, setPanning] = useState(false);

  /* Position along the track, in stage units: 0 at the first node, 4 at the last. */
  const at = useMotionValue(0);

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setBox({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /*
    Upper bound raised for the wide layout: on a phone the width puts this on the
    lower bound, so the small screen keeps the size it already had.
  */
  const badge = Math.round(clamp(box.w * 0.11, 34, 72));
  const beanSize = Math.round(clamp(badge * 0.42, 16, 28));
  /* Radius of the rolling bean, in px. Only used to turn distance into spin. */
  const beanR = beanSize / 2;
  /*
    Nodes climb from the lower left to the upper right. The insets keep the first
    and last badge, and the drop number under each, inside the box.
  */
  const padX = badge * 0.7 + 4;
  const nodes: Point[] = DROPS.map((_, i) => ({
    x: padX + ((box.w - padX * 2) * i) / LAST,
    y: box.h * 0.74 - box.h * 0.5 * (i / LAST),
  }));

  /* Straight segments, so distance along the track is a running sum. */
  const segments = nodes.slice(1).map((node, i) => Math.hypot(node.x - nodes[i].x, node.y - nodes[i].y));

  /*
    The rule belongs in the gaps, not under the badges, so each segment is pulled
    back from the badge at either end. `gaps` are what gets drawn; the bean still
    travels the full node-to-node distance behind them.
  */
  const trim = badge / 2 + 5;
  const gaps: Gap[] = segments.map((length, i) => {
    const from = nodes[i];
    const to = nodes[i + 1];
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    return {
      x1: from.x + ux * trim,
      y1: from.y + uy * trim,
      x2: to.x - ux * trim,
      y2: to.y - uy * trim,
    };
  });

  /* A fast flick back to the start makes the snap spring dip just below 0, so the segment is clamped at both ends. */
  const pointAt = (value: number): Point => {
    if (!box.w) return { x: 0, y: 0 };
    const seg = clamp(Math.floor(value), 0, LAST - 1);
    const t = clamp(value - seg, 0, 1);
    return {
      x: nodes[seg].x + (nodes[seg + 1].x - nodes[seg].x) * t,
      y: nodes[seg].y + (nodes[seg + 1].y - nodes[seg].y) * t,
    };
  };
  /* Spin comes off the real distance travelled, not the shortened drawn one. */
  const travelAt = (value: number) => {
    const seg = clamp(Math.floor(value), 0, LAST - 1);
    const t = clamp(value - seg, 0, 1);
    return segments.slice(0, seg).reduce((sum, length) => sum + length, 0) + segments[seg] * t;
  };

  const beanX = useTransform(at, (v) => pointAt(v).x);
  const beanY = useTransform(at, (v) => pointAt(v).y);
  /* Distance travelled becomes spin, so the bean reads as rolling rather than sliding. */
  const beanSpin = useTransform(at, (v) => (travelAt(v) / beanR) * (180 / Math.PI));

  useMotionValueEvent(at, 'change', (v) => setActive(clamp(Math.round(v), 0, LAST)));

  /*
    The stage the bean is heading for, held in a ref because two taps in quick
    succession have to accumulate. Reading `active` gives the same stale value to
    both, and reading `at` is no better: the spring has barely left the previous
    node when the second tap arrives.
  */
  const heading = useRef(0);
  const goTo = (index: number) => {
    const target = clamp(index, 0, LAST);
    heading.current = target;
    setActive(target);
    animate(at, target, reduced ? { duration: 0 } : SNAP);
  };
  const step = (by: number) => goTo(heading.current + by);

  const done = active === LAST;

  return (
    <div
      className="mx-auto w-full max-w-xl md:max-w-3xl lg:max-w-5xl"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
    >
      <div className="relative flex items-center gap-1">
        <ArrowButton side="left" disabled={active === 0} onClick={() => step(-1)} />

        <motion.div
          ref={boxRef}
          className={`relative h-44 flex-1 select-none md:h-64 lg:h-80 ${panning ? 'touch-none' : 'touch-pan-y'}`}
          onPanStart={() => setPanning(true)}
          onPan={(_, info) => {
            /* One badge-to-badge gap of travel per step, clamped at both ends. */
            const perStage = (box.w - padX * 2) / LAST || 1;
            at.set(clamp(at.get() + info.delta.x / perStage, 0, LAST));
          }}
          onPanEnd={() => {
            setPanning(false);
            goTo(Math.round(at.get()));
          }}
        >
          {box.w > 0 && (
            <svg
              aria-hidden
              width={box.w}
              height={box.h}
              className="absolute inset-0 overflow-visible"
            >
              {/* What is still ahead: a faint rule the bean has not reached. */}
              {gaps.map((gap, i) => (
                <line
                  key={`rule-${i}`}
                  x1={gap.x1}
                  y1={gap.y1}
                  x2={gap.x2}
                  y2={gap.y2}
                  stroke="var(--edge-default)"
                  strokeWidth={1.5}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                />
              ))}
              {/* What is done, one gap at a time. */}
              {gaps.map((gap, i) => (
                <Ink key={`ink-${i}`} gap={gap} index={i} at={at} />
              ))}
            </svg>
          )}

          {/* The bean on the line, between the badge it left and the one ahead. */}
          {box.w > 0 && (
            <motion.span
              aria-hidden
              style={{
                x: beanX,
                y: beanY,
                rotate: beanSpin,
                width: beanSize,
                height: beanSize,
                marginLeft: -beanR,
                marginTop: -beanR,
              }}
              className="absolute left-0 top-0 block text-brand [&>svg]:h-full [&>svg]:w-full"
            >
              <CoffeeBean size="inherit" />
            </motion.span>
          )}

          {box.w > 0 &&
            stages.map((item, index) => (
              <Node
                key={item.title}
                index={index}
                label={item.title}
                live={index === active}
                drops={DROPS[index]}
                point={nodes[index]}
                size={badge}
                at={at}
                onSelect={() => goTo(index)}
              />
            ))}
        </motion.div>

        <ArrowButton side="right" disabled={done} onClick={() => step(1)} />
      </div>

      <div className="mt-2 min-h-[9rem] text-center" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="landing-micro text-ink-secondary">
              {done ? 'Journey complete' : stages[active].badge}
            </p>
            <h3 className="landing-display mt-3 text-[clamp(1.75rem,4vw,2.75rem)] break-keep text-balance">
              {stages[active].title}
            </h3>
            <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-ink-secondary break-keep">
              {stages[active].description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Node({
  index,
  label,
  live,
  drops,
  point,
  size,
  at,
  onSelect,
}: {
  index: number;
  label: string;
  live: boolean;
  drops: number;
  point: Point;
  size: number;
  at: ReturnType<typeof useMotionValue<number>>;
  onSelect: () => void;
}) {
  /* Grows as the bean nears it and settles back once it has passed. */
  const scale = useTransform(at, (v) => 1 + 0.22 * Math.max(0, 1 - Math.abs(v - index)));
  /* A stage still ahead of the bean is held back, not hidden. */
  const opacity = useTransform(at, (v) => (v >= index - 0.5 ? 1 : 0.5));

  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onSelect}
      style={{
        x: point.x,
        y: point.y,
        scale,
        opacity,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
      }}
      className={`absolute left-0 top-0 flex items-center justify-center rounded-full transition-shadow duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        live ? 'shadow-[0_0_0_2px_var(--brand)]' : 'shadow-[0_0_0_1px_var(--edge-default)]'
      }`}
    >
      <GrowthIcon level={index + 1} size={size} />
      {/* The axis reading for this node: how many drops it takes to get here. */}
      <span
        aria-hidden
        className="landing-micro absolute top-full mt-2 text-ink-secondary"
        style={{ fontSize: 11 }}
      >
        {drops}
      </span>
    </motion.button>
  );
}

function ArrowButton({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous stage' : 'Next stage'}
      className="flex h-10 w-8 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-opacity hover:text-ink-primary disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Icon size={22} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
