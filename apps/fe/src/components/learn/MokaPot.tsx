import styles from './MokaPot.module.css';

export default function MokaPot({ locale }: { locale: string }) {
  return (
    <div
      className={styles.mokaPot}
      role="img"
      aria-label={
        locale === 'ko'
          ? '모카 팟의 물이 커피층을 지나 위쪽으로 추출되는 단면 애니메이션'
          : 'Cutaway animation of water passing through coffee and collecting in a moka pot'
      }
    >
      <svg viewBox="0 0 360 440" aria-hidden="true">
        <ellipse className={styles.shadow} cx="180" cy="412" rx="105" ry="9" />
        <path className={styles.handle} d="M247 131H269Q286 131 282 151L268 221Q265 233 249 233" />
        <path className={styles.upper} d="M109 128H251L235 257H125L106 163L85 144H110Z" />
        <path className={styles.upperFacet} d="M132 133L142 251M227 133L217 251" />
        <path className={styles.collected} d="M129 248H231L239 169H119Z" />
        <path className={styles.chimney} d="M170 251V155Q170 148 177 148H183Q190 148 190 155V251Z" />
        <path className={styles.chimneyHighlight} d="M175 159V242" />
        <path className={styles.lower} d="M125 271H235L255 381L238 399H122L105 381Z" />
        <path className={styles.water} d="M115 374H245L235 306H125Z" />
        <path className={styles.lowerFacet} d="M143 277L131 389M217 277L229 389" />
        <path className={styles.funnel} d="M144 277H216L188 302V371H172V302Z" />
        <path className={styles.stem} d="M180 365V296" />
        <rect className={styles.basket} x="143" y="258" width="74" height="23" rx="3" />
        <rect className={styles.grounds} x="148" y="263" width="64" height="13" rx="2" />
        <path className={styles.grain} d="M152 267H208M152 272H208" />
        <g className={styles.extraction}>
          <path className={styles.flow} d="M180 366V151" />
          <path className={styles.spoutFlow} d="M177 151Q159 151 157 169V244M183 151Q201 151 203 169V244" />
        </g>
        <rect className={styles.waist} x="119" y="251" width="122" height="10" rx="3" />
        <path className={styles.filterLine} d="M147 257H213" />
        <path className={styles.lid} d="M104 126L133 108H227L256 126Z" />
        <rect className={styles.lidRim} x="103" y="125" width="154" height="7" rx="2" />
        <path className={styles.knob} d="M168 109L165 93Q165 88 171 88H189Q195 88 195 93L192 109Z" />
        <circle className={styles.valve} cx="228" cy="300" r="6" />
        <circle className={styles.valveCore} cx="228" cy="300" r="2" />
        <path className={styles.base} d="M106 381L122 399H238L254 381" />
        <g className={styles.steam}>
          <path d="M119 94Q111 83 119 72T119 50" />
          <path d="M141 89Q133 78 141 67T141 45" />
        </g>
      </svg>
    </div>
  );
}
