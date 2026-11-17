import { useId } from 'react';
import styles from './FrenchPress.module.css';

export default function FrenchPress({ locale }: { locale: string }) {
  const vesselId = `fp-vessel-${useId().replace(/:/g, '')}`;

  return (
    <div
      className={styles.frenchPress}
      role="img"
      aria-label={
        locale === 'ko'
          ? '프렌치프레스 플런저를 천천히 누르는 애니메이션'
          : 'Animation of a French press plunger slowly pressing down'
      }
    >
      <svg viewBox="0 0 360 400" aria-hidden="true">
        <defs>
          <clipPath id={vesselId}>
            <path d="M105 130H245V325Q245 344 225 344H125Q105 344 105 325Z" />
          </clipPath>
        </defs>
        <ellipse className={styles.shadow} cx="180" cy="365" rx="104" ry="9" />
        <path className={styles.handle} d="M249 158H274Q300 158 300 186V272Q300 300 274 300H249" />
        <path className={styles.glass} d="M101 130H245V325Q245 347 224 347H125Q104 347 104 325V143L91 130Z" />
        <g clipPath={`url(#${vesselId})`}>
          <rect className={styles.coffee} x="105" y="158" width="140" height="186" />
          <path className={styles.surface} d="M105 158Q122 154 140 158T175 158T210 158T245 158" />
          <g className={styles.particles}>
            {Array.from({ length: 32 }, (_, i) => (
              <circle key={i} cx={113 + (i * 37) % 125} cy={174 + (i * 29) % 150} r={1 + (i % 3) * 0.4} />
            ))}
          </g>
          <rect className={styles.grounds} x="105" y="330" width="140" height="14" />
          <g className={styles.filter}>
            <rect x="108" y="149" width="134" height="9" rx="4" />
            <path d="M113 153H237" />
          </g>
        </g>
        <path className={styles.highlight} d="M116 144V322Q116 335 126 335" />
        <path className={styles.frame} d="M119 134V342M231 134V342" />
        <g className={styles.plunger}>
          <path className={styles.rod} d="M175 55V151" />
          <ellipse className={styles.knob} cx="175" cy="51" rx="17" ry="8" />
        </g>
        <path className={styles.lid} d="M100 125Q100 108 121 107H229Q250 108 250 125Z" />
        <rect className={styles.rim} x="96" y="124" width="158" height="9" rx="4" />
        <rect className={styles.base} x="96" y="341" width="158" height="15" rx="5" />
      </svg>
    </div>
  );
}
