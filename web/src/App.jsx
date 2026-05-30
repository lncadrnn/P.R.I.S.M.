import { useState, useEffect, useRef } from 'react'
import SubmitForm from './components/SubmitForm'
import VerdictCard from './components/VerdictCard'
import { checkHealth } from './api'
import styles from './App.module.css'

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function MockVerdictCard() {
  return (
    <div className={styles.mockCard}>
      <div className={styles.mockHeader}>
        <span className={styles.mockTag}>Output</span>
        <span className={styles.mockTitle}>Verdict</span>
      </div>
      <div className={styles.mockBody}>
        <div className={styles.mockVerdict}>
          <div className={styles.mockBadgeFake}>FAKE</div>
          <div className={styles.mockConfRow}>
            <div className={styles.mockBar}>
              <div className={styles.mockBarFill} style={{ width: '87%' }} />
            </div>
            <span className={styles.mockPct}>87%</span>
          </div>
          <div className={styles.mockMeta}>
            <span>Based on:</span>
            <span className={styles.mockChip}>text</span>
            <span className={styles.mockChip}>image</span>
          </div>
        </div>
        <p className={styles.mockLabel}>Module Breakdown</p>
        <div className={styles.mockModules}>
          <div className={styles.mockRow}>
            <span className={styles.mockKey}>text</span>
            <span className={`${styles.mockRowVerdict} ${styles.mockFake}`}>FAKE</span>
            <div className={styles.mockModBar}>
              <div className={`${styles.mockModFill} ${styles.mockFakeFill}`} style={{ width: '91%' }} />
            </div>
            <span className={styles.mockConf}>91%</span>
          </div>
          <div className={styles.mockRow}>
            <span className={styles.mockKey}>image</span>
            <span className={`${styles.mockRowVerdict} ${styles.mockReal}`}>REAL</span>
            <div className={styles.mockModBar}>
              <div className={`${styles.mockModFill} ${styles.mockRealFill}`} style={{ width: '24%' }} />
            </div>
            <span className={styles.mockConf}>24%</span>
          </div>
          <div className={styles.mockRow}>
            <span className={styles.mockKey}>video</span>
            <span className={styles.mockStubTxt}>No video submitted</span>
          </div>
        </div>
        <p className={styles.mockLabel}>LIME: word-level explanation</p>
        <p className={styles.mockLime}>
          <span className={styles.mockWFakeH}>BREAKING</span>{' '}
          <span>ang </span>
          <span className={styles.mockWFakeM}>viral</span>{' '}
          <span>na </span>
          <span className={styles.mockWReal}>litrato</span>{' '}
          <span>ay </span>
          <span className={styles.mockWFakeL}>peke</span>{' '}
          <span>raw</span>
        </p>
      </div>
    </div>
  )
}

const MODULES = [
  {
    key: 'text',
    title: 'Text Analysis',
    model: 'DistilBERT-Tagalog',
    xai: 'LIME + Anchors',
    desc: 'Fine-tuned on Filipino BERT, detects AI-generated captions and fake news in Taglish. Word-level LIME highlights show which phrases drove the verdict.',
  },
  {
    key: 'image',
    title: 'Image Forensics',
    model: 'CNN-ViT hybrid',
    xai: 'Class Activation Maps',
    desc: 'Classifies GAN- and diffusion-generated images. Class Activation Maps overlay heatmaps directly on the manipulated image regions.',
  },
  {
    key: 'video',
    title: 'Video Detection',
    model: 'Frame-level forensic engine',
    xai: 'Frame artifact overlay',
    desc: 'Detects spatial pixel artifacts and temporal inconsistencies. Catches lip-sync mismatch, pixel jitter, and inter-frame anomalies across frames.',
  },
]

export default function App() {
  const [result, setResult] = useState(null)
  const [apiOnline, setApiOnline] = useState(null)
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem('prism-theme')
    if (stored) return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const scanRef = useRef(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('prism-theme', theme)
  }, [theme])

  useEffect(() => {
    checkHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false))
  }, [])

  const statusClass =
    apiOnline === null ? styles.statusChecking
    : apiOnline ? styles.statusOnline
    : styles.statusOffline

  const statusText =
    apiOnline === null ? 'Connecting'
    : apiOnline ? 'API online'
    : 'API offline'

  function scrollToScan() {
    scanRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>P</div>
          <div className={styles.logoText}>
            <span className={styles.prism}>PRISM</span>
            <span className={styles.taglineTxt}>Synthetic Media Detector</span>
          </div>
        </div>
        <nav className={styles.nav}>
          <a href="#how-it-works" className={styles.navLink}>How it works</a>
          <a href="#modules" className={styles.navLink}>Modules</a>
          <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer" className={styles.navLink}>API docs</a>
        </nav>
        <div className={styles.headerRight}>
          <div className={`${styles.statusPill} ${statusClass}`}>
            <span className={styles.statusDot} />
            {statusText}
          </div>
          <button
            className={styles.themeToggle}
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroLeft}>
          <p className={styles.heroEyebrow}>Multimodal disinformation detection for Filipino social media</p>
          <h1 className={styles.heroTitle}>Spot fake content before it spreads</h1>
          <p className={styles.heroDesc}>
            Submit a social media post and PRISM routes it through independent text, image, and video
            forensic modules. Confidence scores are fused into a single credibility verdict with
            word-level and pixel-level explanations.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.heroCta} onClick={scrollToScan}>Scan a post</button>
            <a href="/docs/PRISM.pdf" className={styles.heroSecondary} target="_blank" rel="noreferrer">Read the paper</a>
          </div>
          <div className={styles.heroBadges}>
            <span className={styles.heroBadge}>Filipino / Taglish</span>
            <span className={styles.heroBadge}>Facebook, TikTok, X</span>
            <span className={styles.heroBadge}>Explainable AI</span>
            <span className={styles.heroBadge}>Late fusion</span>
          </div>
        </div>
        <div className={styles.heroRight}>
          <MockVerdictCard />
        </div>
      </section>

      <section id="how-it-works" className={styles.section}>
        <div className={styles.sectionInner}>
          <p className={styles.sectionEyebrow}>How it works</p>
          <h2 className={styles.sectionTitle}>Three modules, one verdict</h2>
          <p className={styles.sectionDesc}>
            Modules run independently with no shared loss functions or intermediate coupling.
            Late fusion combines only the modalities present in each post.
          </p>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNum}>01</div>
              <div className={styles.stepContent}>
                <div className={styles.stepTitle}>Submit content</div>
                <div className={styles.stepDesc}>Paste a caption, upload an image, or both. Video module is in development.</div>
              </div>
            </div>
            <div className={styles.stepLine} />
            <div className={styles.step}>
              <div className={styles.stepNum}>02</div>
              <div className={styles.stepContent}>
                <div className={styles.stepTitle}>Forensic analysis</div>
                <div className={styles.stepDesc}>Each modality routes to its dedicated AI module for independent inference.</div>
              </div>
            </div>
            <div className={styles.stepLine} />
            <div className={styles.step}>
              <div className={styles.stepNum}>03</div>
              <div className={styles.stepContent}>
                <div className={styles.stepTitle}>Fused verdict</div>
                <div className={styles.stepDesc}>Module scores are weighted and combined. The XAI layer shows which words and image regions drove the decision.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="modules" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <p className={styles.sectionEyebrow}>Forensic modules</p>
          <h2 className={styles.sectionTitle}>Independent, swappable, explainable</h2>
          <div className={styles.moduleCards}>
            {MODULES.map(m => (
              <div key={m.key} className={styles.moduleCard}>
                <div className={styles.moduleCardTop}>
                  <span className={styles.moduleCardKey}>{m.key}</span>
                </div>
                <div className={styles.moduleCardTitle}>{m.title}</div>
                <div className={styles.moduleCardDesc}>{m.desc}</div>
                <div className={styles.moduleCardMeta}>
                  <div className={styles.moduleCardMetaRow}>
                    <span className={styles.moduleCardMetaLabel}>Model</span>
                    <span className={styles.moduleCardMetaVal}>{m.model}</span>
                  </div>
                  <div className={styles.moduleCardMetaRow}>
                    <span className={styles.moduleCardMetaLabel}>XAI</span>
                    <span className={styles.moduleCardMetaVal}>{m.xai}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="scan" className={styles.section} ref={scanRef}>
        <div className={styles.sectionInner}>
          <p className={styles.sectionEyebrow}>Scanner</p>
          <h2 className={styles.sectionTitle}>Submit a post for analysis</h2>
          <div className={result ? styles.grid : styles.singleCol}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.panelTag}>Input</span>
                <span className={styles.panelTitle}>Content</span>
              </div>
              <div className={styles.panelBody}>
                <SubmitForm onResult={setResult} disabled={apiOnline === false} />
              </div>
            </div>

            {result && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <span className={styles.panelTag}>Output</span>
                  <span className={styles.panelTitle}>Verdict</span>
                </div>
                <div className={styles.panelBody}>
                  <VerdictCard result={result} />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerLeft}>
            <span className={styles.footerBrand}>PRISM</span>
            <span>Next Gen Start-up Competition 2026, Mapua University Makati</span>
          </div>
          <div className={styles.footerRight}>
            <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API docs</a>
            <a href="/docs/PRISM.pdf" target="_blank" rel="noreferrer">Research paper</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
