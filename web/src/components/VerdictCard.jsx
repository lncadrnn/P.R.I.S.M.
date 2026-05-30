import styles from './VerdictCard.module.css'

const LABELS = { fake: 'FAKE', real: 'REAL', unknown: 'No Verdict' }
const STUBS  = { text: 'No caption submitted', image: 'No image submitted', video: 'No video submitted' }

// Non-color verdict cues so the verdict is legible without relying on red/green.
function VerdictIcon({ cls }) {
  const common = {
    className: styles.badgeIcon,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (cls === 'fake') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    )
  }
  if (cls === 'real') {
    return (
      <svg {...common}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

export default function VerdictCard({ result }) {
  const { label, confidence, modules, explanation } = result
  const pct = Math.round(confidence * 100)
  const cls = ['fake','real','unknown'].includes(label) ? label : 'unknown'

  return (
    <div className={styles.card}>
      <div className={`${styles.verdictHero} ${styles[cls]}`}>
        <div className={`${styles.badge} ${styles[cls]}`}>
          <VerdictIcon cls={cls} />
          {LABELS[cls] ?? cls.toUpperCase()}
        </div>
        {cls === 'unknown' ? (
          <p className={styles.unknownNote}>
            No conclusive verdict.
            {explanation?.abstained?.length
              ? ` The ${explanation.abstained.join(', ')} module${explanation.abstained.length > 1 ? 's' : ''} abstained (not trained yet).`
              : ''}
            {' '}Add a caption — the text model is trained and returns a real verdict.
          </p>
        ) : (
          <div className={styles.confidenceRow}>
            <div className={styles.bar}>
              <div className={`${styles.fill} ${styles[cls]}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.confidencePct}>{pct}%</span>
          </div>
        )}
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
          <p className={styles.sectionLabelXai}>GradCAM: image regions that influenced the verdict</p>
          <img
            src={`data:image/png;base64,${modules.image.explanation.heatmap_b64}`}
            alt="GradCAM heatmap"
            className={styles.heatmapImg}
          />
        </div>
      )}

      {modules?.image?.explanation?.signals?.length > 0 && (
        <div className={styles.why}>
          <p className={styles.sectionLabelXai}>Image forensics signals</p>
          <div className={styles.reasons}>
            {modules.image.explanation.signals.map((s, i) => (
              <div key={i} className={`${styles.reason} ${styles.sevLow}`}>
                <p className={styles.reasonDetail}>{s}</p>
              </div>
            ))}
          </div>
          {modules.image.explanation.note && (
            <p className={styles.whySummary}>{modules.image.explanation.note}</p>
          )}
        </div>
      )}

      {modules?.text?.explanation?.summary && (
        <WhySection explanation={modules.text.explanation} />
      )}

      {modules?.text?.explanation?.top_words && (
        <LimeHighlights words={modules.text.explanation.top_words} label={modules.text.label} />
      )}
    </div>
  )
}

function ModuleRow({ name, data, stub }) {
  // Modality not submitted at all.
  if (!data) {
    return (
      <div className={styles.moduleRow}>
        <span className={styles.moduleKey}>{name}</span>
        <span className={styles.moduleStub}>{stub}</span>
      </div>
    )
  }

  // Module ran but abstained — show why, not a fake 0% bar.
  const scored = data.label === 'fake' || data.label === 'real'
  if (!scored) {
    return (
      <div className={styles.moduleRow}>
        <span className={styles.moduleKey}>{name}</span>
        <span className={styles.moduleStub}>No conclusive signal</span>
      </div>
    )
  }

  const pct = Math.round(data.confidence * 100)
  const cls = data.label
  return (
    <div className={styles.moduleRow}>
      <span className={styles.moduleKey}>{name}</span>
      <span className={`${styles.moduleLabel} ${styles[cls]}`}>{data.label.toUpperCase()}</span>
      <div className={styles.moduleBar}>
        <div className={`${styles.moduleBarFill} ${styles[cls]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.moduleConf}>{pct}%</span>
    </div>
  )
}

const SEVERITY_CLASS = { high: 'sevHigh', medium: 'sevMed', low: 'sevLow' }

function WhySection({ explanation }) {
  const { summary, reasons } = explanation
  return (
    <div className={styles.why}>
      <p className={styles.sectionLabel}>Why this verdict?</p>
      {summary && <p className={styles.whySummary}>{summary}</p>}
      {reasons?.length > 0 && (
        <div className={styles.reasons}>
          {reasons.map((r, i) => (
            <div key={i} className={`${styles.reason} ${styles[SEVERITY_CLASS[r.severity] ?? 'sevLow']}`}>
              <div className={styles.reasonHeader}>
                <span className={styles.reasonCat}>{r.category}</span>
                <span className={styles.reasonSev}>{r.severity}</span>
              </div>
              <p className={styles.reasonDetail}>{r.detail}</p>
              {r.matched?.length > 0 && (
                <div className={styles.reasonMatched}>
                  {r.matched.map((m, j) => (
                    <code key={j} className={styles.matchedWord}>{m}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LimeHighlights({ words, label }) {
  const isFake = label === 'fake'
  return (
    <div className={styles.lime}>
      <p className={styles.sectionLabelXai}>LIME: word-level explanation</p>
      <p className={styles.limeText}>
        {words.map((w, i) => {
          const pushesTowardFake = isFake ? w.weight > 0 : w.weight < 0
          const alpha = Math.min(Math.abs(w.weight) * 4, 0.65)
          // Theme-aware: resolves against the active --fake/--real token in both modes.
          const pct = Math.round(alpha * 100)
          const bg = pushesTowardFake
            ? `color-mix(in srgb, var(--fake) ${pct}%, transparent)`
            : `color-mix(in srgb, var(--real) ${pct}%, transparent)`
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
