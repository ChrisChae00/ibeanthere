import { useId } from 'react';
import styles from './PourOverAnimation.module.css';

export default function PourOverAnimation({ locale }: { locale: string }) {
  const clipId = `coffee-server-${useId().replace(/:/g, '')}`;

  return (
    <div className={styles.pourOver}>
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label={
          locale === 'ko'
            ? '주전자를 움직이며 커피를 내리는 푸어오버 애니메이션'
            : 'Animation of pour-over coffee being brewed with a moving kettle'
        }
      >
        <defs>
          <clipPath id={clipId}>
            <path d="M119 204h82l19 66q3 12-12 12h-96q-15 0-12-12z" />
          </clipPath>
        </defs>

        <g className={styles.orbit}>
          <g className={styles.kettle}>
            <path
              d="M245 76c32-18 46 25 14 31"
              fill="none"
              stroke="#766352"
              strokeWidth="7"
            />
            <path
              d="M202 65h47l13 47q2 12-12 12h-51q-13 0-11-12l4-16-30-17 4-10 34 12z"
              fill="#eee5d7"
              stroke="#766352"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d="M198 64h55M222 57h10"
              fill="none"
              stroke="#766352"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
          <path
            className={styles.water}
            d="M164 80Q151 104 160 142"
            fill="none"
            stroke="#8ebfc9"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>

        <path
          d="M111 145h98l-33 48h-32z"
          fill="#fbf5eb"
          stroke="#766352"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <ellipse cx="160" cy="147" rx="46" ry="8" fill="#79523a" />
        <ellipse
          className={styles.bloom}
          cx="160"
          cy="147"
          rx="22"
          ry="5"
          fill="#b88b64"
        />
        <path
          d="M109 197h102"
          fill="none"
          stroke="#766352"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <g className={styles.drips}>
          <ellipse className={styles.drop} cx="155" cy="198" rx="2.5" ry="3.5" fill="#a5683e" />
          <ellipse className={styles.dropSecond} cx="165" cy="198" rx="2.5" ry="3.5" fill="#a5683e" />
        </g>
        <g clipPath={`url(#${clipId})`}>
          <rect
            className={styles.coffee}
            x="95"
            y="233"
            width="130"
            height="55"
            fill="#a5683e"
          />
        </g>
        <path
          d="M206 222h12c25 0 25 34-5 34"
          fill="none"
          stroke="#766352"
          strokeWidth="5"
        />
        <path
          d="M119 204h82l19 66q3 12-12 12h-96q-15 0-12-12z"
          fill="none"
          stroke="#766352"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M74 285h172"
          fill="none"
          stroke="#d8cbbb"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
