import styles from './TurkishCoffee.module.css';

const foamCells = [
  [128, 189, 5, 0],
  [141, 185, 6, -1.1],
  [155, 184, 7, -2.3],
  [170, 185, 6, -3.4],
  [185, 188, 5.5, -1.8],
  [136, 195, 4, -3],
  [151, 196, 4.5, -0.7],
  [167, 196, 4, -2.7],
  [182, 195, 4, -4.1],
];

export default function TurkishCoffee({ locale }: { locale: string }) {
  return (
    <div
      className={styles.turkishCoffee}
      role="img"
      aria-label={
        locale === 'ko'
          ? '체즈베에서 터키시 커피의 거품이 천천히 부풀어 오르는 애니메이션'
          : 'Animation of Turkish coffee foam slowly rising in a cezve'
      }
    >
      <svg viewBox="0 0 360 440" aria-hidden="true">
        <ellipse className={styles.shadow} cx="170" cy="399" rx="111" ry="10" />
        <path className={styles.handle} d="M208 181L307 108" />
        <path className={styles.handleHighlight} d="M243 151L301 109" />
        <path className={styles.bracket} d="M205 183L233 164" />
        <path className={styles.body} d="M113 191Q121 238 104 282L88 330Q83 349 104 356Q159 373 214 356Q235 349 230 330L214 282Q197 238 205 191Z" />
        <path className={styles.facet} d="M127 216Q137 255 121 303L112 335M191 216Q182 255 197 303L206 335" />
        <path className={styles.bodyHighlight} d="M110 287L99 326Q95 338 106 342" />
        <path className={styles.base} d="M103 355Q159 372 215 355" />
        <path className={styles.mouth} d="M114 183Q158 168 203 183Q217 190 204 201Q159 217 115 201L96 184Z" />
        <ellipse className={styles.coffee} cx="159" cy="193" rx="43" ry="12" />
        <g className={styles.foam}>
          <path className={styles.foamCap} d="M118 191Q119 185 127 186Q132 180 140 184Q147 178 155 182Q164 177 172 183Q181 179 187 185Q197 182 200 191Q201 196 194 197Q191 202 183 199Q176 205 168 201Q160 206 152 202Q144 206 137 201Q128 204 125 198Q117 198 118 191Z" />
          {foamCells.map(([cx, cy, r, delay], i) => (
            <g
              className={styles.foamCell}
              key={i}
              style={{ animationDelay: `${delay}s` }}
            >
              <circle className={styles.cellBody} cx={cx} cy={cy} r={r} />
              <path
                className={styles.cellShine}
                d={`M${cx - r * 0.5} ${cy - r * 0.15}Q${cx - r * 0.45} ${cy - r * 0.6} ${cx} ${cy - r * 0.6}`}
              />
            </g>
          ))}
          {Array.from({ length: 13 }, (_, i) => (
            <circle
              className={styles.bubble}
              key={i}
              cx={126 + (i * 19) % 65}
              cy={190 + (i * 7) % 9}
              r={1 + (i % 3) * 0.4}
              style={{ animationDelay: `${-i * 0.39}s` }}
            />
          ))}
        </g>
        <path className={styles.rim} d="M96 184L115 201Q159 217 204 201Q217 190 203 183" />
        <g className={styles.steam}>
          <path className={styles.steamOne} d="M139 153Q128 139 139 125T139 97" />
          <path className={styles.steamTwo} d="M163 149Q152 135 163 121T163 93" />
          <path className={styles.steamThree} d="M185 155Q174 141 185 127T185 99" />
        </g>
        <path className={styles.burner} d="M114 391H204" />
        <g className={styles.heat}>
          <path d="M132 383Q126 376 134 368Q140 377 137 383Z" />
          <path d="M156 383Q148 374 159 363Q169 376 164 383Z" />
          <path d="M180 383Q176 376 184 368Q191 378 186 383Z" />
        </g>
      </svg>
    </div>
  );
}
