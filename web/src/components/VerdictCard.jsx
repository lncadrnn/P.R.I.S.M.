import styles from './VerdictCard.module.css'

const LABELS = { fake: 'FAKE', real: 'REAL', unknown: 'UNKNOWN' }

export default function VerdictCard({ result }) {
  const { label, confidence, modules, explanation } = result
  const pct = Math.round(confidence * 100)
  const imageModule = modules?.image
  const textModule  = modules?.text

  return (
    <div className={styles.card}>
      {/* Overall verdict */}
      <div className={styles.top}>
        <div className={`${styles.badge} ${styles[label]}`}>
          {LABELS[label] ?? label.toUpperCase()}
        </div>
        <div className={styles.confidenceWrap}>
          <span className={styles.confidenceLabel}>Confidence</span>
          <div className={styles.bar}>
            <div
              className={`${styles.fill} ${styles[label]}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={styles.confidencePct}>{pct}%</span>
        </div>
      </div>

      {/* Fusion explanation */}
      {explanation?.modules_used?.length > 0 && (
        <p className={styles.meta}>
          Verdict based on:{' '}
          {explanation.modules_used.map(m => (
            <span key={m} className={styles.chip}>{m}</span>
          ))}
        </p>
      )}

      {/* Module breakdown */}
      <div className={styles.modules}>
        <ModuleRow name="Text"  data={textModule}  stub="Text module not yet implemented" />
        <ModuleRow name="Image" data={imageModule} stub="No image submitted" />
        <ModuleRow name="Video" data={modules?.video} stub="Video module not yet implemented" />
      </div>

      {/* GradCAM heatmap */}
      {imageModule?.explanation?.heatmap_b64 && (
        <div className={styles.heatmap}>
          <p className={styles.heatmapLabel}>GradCAM — regions that triggered the image verdict</p>
          <img
            src={`data:image/png;base64,${imageModule.explanation.heatmap_b64}`}
            alt="GradCAM heatmap"
            className={styles.heatmapImg}
          />
        </div>
      )}

      {/* LIME text highlights (ready for when text module ships) */}
      {textModule?.explanation?.highlights && (
        <LimeHighlights highlights={textModule.explanation.highlights} />
      )}
    </div>
  )
}

function ModuleRow({ name, data, stub }) {
  return (
    <div className={styles.moduleRow}>
      <span className={styles.moduleName}>{name}</span>
      {data ? (
        <>
          <span className={`${styles.moduleLabel} ${styles[data.label]}`}>
            {data.label.toUpperCase()}
          </span>
          <span className={styles.moduleConf}>{Math.round(data.confidence * 100)}%</span>
        </>
      ) : (
        <span className={styles.moduleStub}>{stub}</span>
      )}
    </div>
  )
}

function LimeHighlights({ highlights }) {
  return (
    <div className={styles.lime}>
      <p className={styles.heatmapLabel}>LIME — word-level explanation</p>
      <p className={styles.limeText}>
        {highlights.map((w, i) => (
          <span
            key={i}
            className={styles.limeWord}
            style={{
              background: w.score > 0
                ? `rgba(239,68,68,${Math.min(w.score, 1) * 0.6})`
                : `rgba(34,197,94,${Math.min(Math.abs(w.score), 1) * 0.6})`,
            }}
          >
            {w.word}{' '}
          </span>
        ))}
      </p>
    </div>
  )
}
