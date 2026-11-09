import { useId } from 'react';
import styles from './SiphonCoffee.module.css';

export default function SiphonCoffee({ locale }: { locale: string }) {
  const flaskClipId = `sc-local-flask-${useId().replace(/:/g, '')}`;

  return (
    <div
      className={styles.siphonCoffee}
      role="img"
      aria-label={
        locale === 'ko'
          ? '사이폰의 물이 위로 올라가 커피를 우린 뒤 아래 플라스크로 내려오는 애니메이션'
          : 'Animation of water rising through a siphon to brew coffee, then flowing back into the lower flask'
      }
    >
      <svg viewBox="0 0 360 460" aria-hidden="true">
        <ellipse className={styles.shadow} cx="180" cy="435" rx="112" ry="9" />
        <path className={styles.stand} d="M270 420V149Q270 134 255 134H228" />
        <path className={styles.foot} d="M224 426H310" />
        <path className={styles.clamp} d="M221 126H245V142H221" />
        <path className={styles.glass} d="M148 231V249C116 260 98 283 98 313C98 354 127 380 166 380S234 354 234 313C234 283 216 260 184 249V231Z" />
        <svg x="102" y="253" width="128" height="123" viewBox="0 0 128 123" overflow="hidden">
          <defs>
            <clipPath id={flaskClipId}>
              <path d="M46 0C18 10 0 31 0 60C0 98 27 123 64 123S128 98 128 60C128 31 110 10 82 0Z" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${flaskClipId})`}>
            <rect className={styles.bottomWater} x="0" y="35" width="128" height="88" />
            <rect className={styles.bottomCoffee} x="0" y="35" width="128" height="88" />
          </g>
        </svg>
        <path className={styles.tubeGlass} d="M158 190H174V333H158Z" />
        <path className={styles.upperGlass} d="M119 58H213V167Q213 185 192 194L176 202H156L140 194Q119 185 119 167Z" />
        <path className={styles.upperLiquid} d="M124 91H208V165Q208 181 188 189L175 196H157L144 189Q124 181 124 165Z" />
        <g className={styles.grounds}>
          {Array.from({ length: 28 }, (_, i) => (
            <circle key={i} cx={132 + (i * 23) % 69} cy={111 + (i * 19) % 66} r={1 + (i % 3) * 0.35} />
          ))}
        </g>
        <path className={styles.upperHighlight} d="M128 70V162Q128 175 140 181" />
        <path className={styles.flaskHighlight} d="M127 276Q107 294 111 319" />
        <rect className={styles.filter} x="148" y="187" width="36" height="6" rx="3" />
        <path className={styles.filterMesh} d="M152 190H180" />
        <g className={styles.flowUp}><path d="M166 331V196" /></g>
        <g className={styles.flowDown}><path d="M166 196V338" /></g>
        <rect className={styles.rim} x="115" y="54" width="102" height="7" rx="3" />
        <rect className={styles.seal} x="144" y="227" width="44" height="13" rx="4" />
        <path className={styles.heater} d="M139 410H193L199 426H133Z" />
        <rect className={styles.wick} x="159" y="402" width="14" height="9" rx="2" />
        <g className={styles.flame}>
          <path className={styles.flameOuter} d="M166 382Q150 396 156 402Q166 411 176 402Q181 395 166 382Z" />
          <path className={styles.flameInner} d="M166 391Q159 399 163 403Q167 406 171 402Q173 399 166 391Z" />
        </g>
      </svg>
    </div>
  );
}
