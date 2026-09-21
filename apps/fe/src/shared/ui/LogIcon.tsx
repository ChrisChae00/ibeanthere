import React from 'react';

interface LogIconProps {
  size?: number;
  className?: string;
}

/**
 * Pencil icon for writing a coffee log.
 *
 * Drawn as a filled path at the same 24px box as HeartIcon and BookmarkIcon, because
 * the three sit side by side on the cafe page: a stroked icon between two filled ones
 * reads as a different size even when the box matches.
 */
export default function LogIcon({ size = 24, className = '' }: LogIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        fill="currentColor"
      />
    </svg>
  );
}
