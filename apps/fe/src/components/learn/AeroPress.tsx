import styles from './AeroPress.module.css';

export default function AeroPress({ locale }: { locale: string }) {
  return (
    <div
      className={styles.aeroPress}
      role="img"
      aria-label={
        locale === 'ko'
          ? '에어로프레스 플런저를 눌러 컵에 커피를 추출하는 애니메이션'
          : 'Animation of pressing an AeroPress plunger to brew coffee into a cup'
      }
    >
      <svg viewBox="0 0 360 440" aria-hidden="true">
        <ellipse className={styles.shadow} cx="180" cy="407" rx="100" ry="9" />
        <path className={styles.cupHandle} d="M238 316H254Q279 316 279 339T254 363H240" />
        <path className={styles.cup} d="M112 302H248L240 380Q238 396 222 396H138Q122 396 120 380Z" />
        <path className={styles.cupCoffee} d="M124 386H236L238 366H122Z" />
        <path className={styles.cupHighlight} d="M129 317L134 376" />
        <path className={styles.chamber} d="M137 112H223V280H137Z" />
        <rect className={styles.brew} x="143" y="145" width="74" height="128" />
        <g className={styles.piston}>
          <path className={styles.shaft} d="M147 28H213V140H147Z" />
          <path className={styles.shaftHighlight} d="M155 36V131" />
          <rect className={styles.top} x="133" y="20" width="94" height="12" rx="4" />
          <rect className={styles.seal} x="141" y="136" width="78" height="12" rx="3" />
        </g>
        <path className={styles.edge} d="M137 112V280M223 112V280" />
        <path className={styles.chamberHighlight} d="M143 159V262" />
        <path className={styles.measure} d="M201 173H212M204 197H212M201 221H212M204 245H212" />
        <rect className={styles.collar} x="130" y="109" width="100" height="9" rx="3" />
        <rect className={styles.filter} x="134" y="272" width="92" height="20" rx="4" />
        <path className={styles.filterLines} d="M145 278V286M155 278V286M165 278V286M175 278V286M185 278V286M195 278V286M205 278V286M215 278V286" />
        <path className={styles.support} d="M119 292H241L247 302H113Z" />
        <g className={styles.extraction}>
          <path className={styles.stream} d="M160 303V386M170 303V386M180 303V386M190 303V386M200 303V386" />
        </g>
      </svg>
    </div>
  );
}
