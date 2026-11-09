'use client';

import styles from './PourOverAnimation.module.css';

export default function PourOverAnimation({ locale }: { locale: string }) {
  return (
    <div className={styles['pour-over']}>
      <div
        className={styles.scene}
        role="img"
        aria-label={locale === 'ko'
          ? '주전자에서 물을 부으면 드리퍼를 지나 서버에 커피가 차오르는 애니메이션'
          : 'Animation of water pouring from a kettle through a dripper and coffee filling a server'}
      >
        <div className={styles.shadow} />
        <div className={styles['pour-motion']}>
          <div className={styles.kettle}>
            <div className={styles.handle} />
            <div className={styles.spout} />
            <div className={styles.body} />
            <div className={styles.lid} />
            <div className={styles.knob} />
            <div className={styles.shine} />
            <div className={styles['water-anchor']}><div className={styles.water} /></div>
          </div>
        </div>
        <div className={styles['dripper-handle']} />
        <div className={styles.dripper}>
          <div className={styles.paper} />
          <div className={styles.grounds} />
          <div className={styles.ribs}>
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} style={{ left: `${17 + i * 21}px`, transform: `rotate(${(i - 3) * 9}deg)` }} />
            ))}
          </div>
        </div>
        <div className={styles.rim} /><div className={styles.base} />
        <div className={styles.ripples}><i /><i /><i /></div>
        <div className={styles['server-handle']} />
        <div className={styles.server}>
          <div className={styles.coffee}><div className={styles.surface} /></div>
          <div className={styles.reflection} />
          <div className={styles.marks}><i /><i /><i /></div>
        </div>
        <div className={styles.lip} /><div className={styles.foot} />
        <div className={styles.drops}><i /><i /><i /></div>
        <div className={styles.steam}><i /><i /><i /></div>
      </div>
    </div>
  );
}
