import styles from './ColdBrew.module.css';

const snowflakes = [
  { x: 134, y: 187, size: 0.55, delay: 0 },
  { x: 225, y: 243, size: 0.65, delay: -1.8 },
  { x: 139, y: 329, size: 0.55, delay: -3.6 },
];

export default function ColdBrew({ locale }: { locale: string }) {
  return (
    <div
      className={styles.coldBrew}
      role="img"
      aria-label={
        locale === 'ko'
          ? '찬물 속 원두가 천천히 우러나는 콜드브루와 눈송이 애니메이션'
          : 'Animation of coffee slowly steeping in cold water with snowflakes'
      }
    >
      <svg viewBox="0 0 360 440" aria-hidden="true">
        <ellipse className={styles.shadow} cx="180" cy="403" rx="102" ry="9" />
        <path className={styles.handle} d="M246 169H264Q288 169 288 195V285Q288 311 264 311H246" />
        <path className={styles.glass} d="M112 116H248V357Q248 384 223 384H137Q112 384 112 357V133L98 117Z" />
        <path className={styles.water} d="M118 165H242V355Q242 378 221 378H139Q118 378 118 355Z" />
        <path className={styles.surface} d="M118 165Q149 160 180 165T242 165" />
        <path className={styles.filter} d="M151 125H209V285Q209 300 194 300H166Q151 300 151 285Z" />
        <path className={styles.mesh} d="M158 134V289M166 134V295M174 134V296M182 134V296M190 134V295M198 134V289M153 148H207M153 162H207M153 176H207M153 190H207M153 204H207M153 218H207M153 232H207M153 246H207M153 260H207M154 274H206M158 288H202" />
        <path className={styles.grounds} d="M156 202Q168 198 179 202T204 202V283Q204 295 193 295H167Q156 295 156 283Z" />
        <g className={styles.grains}>
          {Array.from({ length: 34 }, (_, i) => (
            <circle key={i} cx={160 + (i * 17) % 40} cy={208 + (i * 23) % 78} r={1 + (i % 3) * 0.35} />
          ))}
        </g>
        <path className={styles.highlight} d="M126 137V350Q126 365 137 367" />
        <rect className={styles.lid} x="106" y="105" width="148" height="14" rx="5" />
        <path className={styles.lidTop} d="M115 105V99Q115 94 121 94H239Q245 94 245 99V105Z" />
        <path className={styles.base} d="M125 377Q180 393 235 377" />
        {snowflakes.map(({ x, y, size, delay }, i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${size})`}>
            <g
              className={`${styles.snowflake} ${styles[`snowflake${i + 1}`]}`}
              style={{ animationDelay: `${delay}s` }}
            >
              <path d="M0-15V15M-13-7.5L13 7.5M-13 7.5L13-7.5M-4-11L0-7L4-11M-4 11L0 7L4 11M-11.5-2L-6-3.5L-7.5-9M11.5 2L6 3.5L7.5 9M-7.5 9L-6 3.5L-11.5 2M7.5-9L6-3.5L11.5-2" />
            </g>
          </g>
        ))}
        <g className={styles.condensation}>
          <path d="M233 208Q228 215 233 217Q238 215 233 208Z" />
          <path d="M132 265Q128 272 132 274Q136 272 132 265Z" />
          <path d="M230 331Q226 338 230 340Q234 338 230 331Z" />
        </g>
      </svg>
    </div>
  );
}
