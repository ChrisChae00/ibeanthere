'use client';

/*
  The hero's moving backdrop, on its own: the still, the gust video over it, and
  the scrim that lets light ink sit on top.

  Split out of `HeroBackdrop` so a second hero composition can stand on the same
  media without copying the gust cycle. `HeroBackdrop` renders it and lays its
  own copy over it; nothing about the shipped hero changed in the move.

  Fills its positioned ancestor -- give the parent `relative` and a height.
*/

import { useEffect, useRef, useState } from 'react';

/*
  Milliseconds of stillness between gusts, measured from the end of the previous
  one rather than on a fixed interval. A wall-clock interval shorter than the
  clip would keep firing while it plays and start the next gust the instant it
  landed; timing the rest from `ended` is what makes the pause a real pause.
*/
const REST_BETWEEN_GUSTS = 2000;

/*
  The clip is a single gust - it builds over about a second and a half and has
  settled by the end - encoded forwards then backwards so its last frame is its
  first. That is what lets it rewind to a standstill without a visible jump: the
  foliage genuinely does not return to its starting position on its own.

  Two cuts of the same clip. The 2.36:1 original crops to a narrow slice of its own
  middle on a phone, so below 1024px a 9:16 cut of it plays instead, framed on the
  counter and the heater. The source clip holds only the middle band of the
  photograph, so this cut is tighter than a still could be; the still under it is its
  own first frame for the same reason the landscape one is.
*/
const WIDE = '(min-width: 1024px)';
const MOTION_OK = '(prefers-reduced-motion: no-preference)';
const WIDE_SRC = '/pics/hero-loop.mp4';
const TALL_SRC = '/pics/hero-loop-tall.mp4';

export default function HeroMedia() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const wide = window.matchMedia(WIDE);
    const motion = window.matchMedia(MOTION_OK);
    // A reader who asked the browser to save data gets the still, as reduced motion does.
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    let timer: number | undefined;

    const scheduleGust = () => {
      timer = window.setTimeout(() => {
        // A gust already running swallows its own trigger; nothing queues up.
        if (video.paused) void video.play().catch(() => {});
      }, REST_BETWEEN_GUSTS);
    };
    const settle = () => {
      video.currentTime = 0;
      video.pause();
      scheduleGust();
    };
    const reveal = () => setVideoReady(true);

    const start = () => {
      video.addEventListener('ended', settle);
      video.addEventListener('canplaythrough', reveal);
      // Assigning the source here, not in markup, is what keeps the other cut unfetched.
      video.src = wide.matches ? WIDE_SRC : TALL_SRC;
      scheduleGust();
    };
    const stop = () => {
      window.clearTimeout(timer);
      video.removeEventListener('ended', settle);
      video.removeEventListener('canplaythrough', reveal);
      video.pause();
      video.removeAttribute('src');
      // Without this the browser keeps streaming the source it no longer has.
      video.load();
      setVideoReady(false);
    };

    const allowed = () => motion.matches && !saveData;

    /*
      Re-checked on every change, not just at mount: a tablet turned from landscape to
      portrait swaps to the other cut, and turning reduced motion on stops it.
    */
    const sync = () => {
      stop();
      if (allowed()) start();
    };
    if (allowed()) start();
    wide.addEventListener('change', sync);
    motion.addEventListener('change', sync);

    return () => {
      wide.removeEventListener('change', sync);
      motion.removeEventListener('change', sync);
      stop();
    };
  }, []);

  return (
    <div className="absolute inset-0">
      {/*
        Art direction, not a resolution switch, so this is a `picture` rather
        than a `next/image`: the two files are different crops of the scene and
        only one of them may ever be fetched.
      */}
      <picture>
        <source media="(min-width: 1024px)" srcSet="/pics/hero-wide.webp" />
        <img
          src="/pics/hero-portrait.webp"
          alt="warm cozy coffee shop interior"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>

      {/*
        Its first frame is exactly the still underneath, so it can fade in over
        the top without anything appearing to change.
      */}
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        aria-hidden
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          videoReady ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/*
        The tinted wash reads `--scrim-media`, not `--brand`. Brand is a
        foreground colour that a dark theme has to make light, and Espresso's
        is `#d4c7b8` - as a wash that whitened the video and left the headline
        fighting its own backdrop. The scrim slot stays dark in all four themes
        and still carries each one's hue.
      */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-linear-to-r from-scrim-media/30 via-scrim-media/30 to-transparent" />
    </div>
  );
}
