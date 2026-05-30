import styles from './VerdictCard.module.css'

const LABELS = { fake: 'FAKE', real: 'REAL', unknown: '?' }
const STUBS  = { text: 'No caption submitted', image: 'No image submitted', video: 'No video submitted' }

export default function VerdictCard({ result }) {
  const { label, confidence, modules, explanation } = result
  const pct = Math.round(confidence * 100)
  const cls = ['fake','real','unknown'].includes(label) ? label : 'unknown'

  return (
    <div className={styles.card}>
      <div className={`${styles.verdictHero} ${styles[cls]}`}>
        <div className={`${styles.badge} ${styles[cls]}`}>
          {LABELS[cls] ?? cls.toUpperCase()}
        </div>
        <div className={styles.confidenceRow}>
          <div className={styles.bar}>
            <div className={`${styles.fill} ${styles[cls]}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.confidencePct}>{pct}%</span>
        </div>
        {explanation?.modules_used?.length > 0 && (
          <div className={styles.meta}>
            <span>Based on:</span>
            {explanation.modules_used.map(m => (
              <span key={m} className={styles.chip}>{m}</span>
            ))}
          </div>
        )}
      </div>

      <p className={styles.modulesLabel}>Module Breakdown</p>
      <div className={styles.modules}>
        {['text','image','video'].map(key => (
          <ModuleRow key={key} name={key} data={modules?.[key]} stub={STUBS[key]} />
        ))}
      </div>

      {modules?.image?.explanation?.heatmap_b64 && (
        <div className={styles.heatmap}>
          <p className={styles.sectionLabel}>GradCAM: image regions that influenced the verdict</p>
          <img
            src={`data:image/png;base64,${modules.image.explanation.heatmap_b64}`}
            alt="GradCAM heatmap"
            className={styles.heatmapImg}
          />
        </div>
      )}

      {modules?.text?.explanation?.top_words && (
        <LimeHighlights words={modules.text.explanation.top_words} label={modules.text.label} />
      )}
    </div>
  )
}

function ModuleRow({ name, data, stub }) {
  const pct = data ? Math.round(data.confidence * 100) : 0
  const cls = data ? (['fake','real','unknown'].includes(data.label) ? data.label : 'unknown') : null
  return (
    <div className={styles.moduleRow}>
      <span className={styles.moduleKey}>{name}</span>
      {data ? (
        <>
          <span className={`${styles.moduleLabel} ${styles[cls]}`}>{data.label.toUpperCase()}</span>
          <div className={styles.moduleBar}>
            <div className={`${styles.moduleBarFill} ${styles[cls]}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.moduleConf}>{pct}%</span>
        </>
      ) : (
        <span className={styles.moduleStub}>{stub}</span>
      )}
    </div>
  )
}

function LimeHighlights({ words, label }) {
  const isFake = label === 'fake'
  return (
    <div className={styles.lime}>
      <p className={styles.sectionLabel}>LIME: word-level explanation</p>
      <p className={styles.limeText}>
        {words.map((w, i) => {
          const pushesTowardFake = isFake ? w.weight > 0 : w.weight < 0
          const alpha = Math.min(Math.abs(w.weight) * 4, 0.65)
          const bg = pushesTowardFake
            ? `rgba(248,113,113,${alpha})`
            : `rgba(52,211,153,${alpha})`
          return (
            <span key={i} className={styles.limeWord} style={{ background: bg }}>
              {w.word}{' '}
            </span>
          )
        })}
      </p>
    </div>
  )
}
