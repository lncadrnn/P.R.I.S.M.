import { useState, useEffect } from 'react'
import SubmitForm from './components/SubmitForm'
import VerdictCard from './components/VerdictCard'
import { checkHealth } from './api'
import styles from './App.module.css'

export default function App() {
  const [result, setResult] = useState(null)
  const [apiOnline, setApiOnline] = useState(null)

  useEffect(() => {
    checkHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false))
  }, [])

  const statusClass = apiOnline === null ? styles.statusChecking : apiOnline ? styles.statusOnline : styles.statusOffline
  const statusText  = apiOnline === null ? 'Connecting…' : apiOnline ? 'All systems online' : 'API offline'

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>P</div>
          <div className={styles.logoText}>
            <span className={styles.prism}>PRISM</span>
            <span className={styles.tagline}>Synthetic Media Detector</span>
          </div>
        </div>
        <div className={`${styles.statusPill} ${statusClass}`}>
          <span className={styles.statusDot} />
          {statusText}
        </div>
      </header>

      <div className={styles.hero}>
        <p className={styles.heroTitle}>Multimodal Disinformation Detection</p>
        <p className={styles.heroDesc}>
          Submit a social media post — caption, image, or both. PRISM runs each through
          independent forensic AI modules and fuses the results into a single credibility verdict.
        </p>
      </div>

      <main className={styles.main}>
        <div className={result ? styles.grid : ''}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelIcon}>🔍</div>
              <span className={styles.panelTitle}>Submit Content</span>
            </div>
            <div className={styles.panelBody}>
              <SubmitForm onResult={setResult} disabled={apiOnline === false} />
            </div>
          </div>

          {result && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelIcon}>⚖️</div>
                <span className={styles.panelTitle}>Forensic Verdict</span>
              </div>
              <div className={styles.panelBody}>
                <VerdictCard result={result} />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        PRISM &nbsp;·&nbsp; Mapúa University &nbsp;·&nbsp; Next Gen Start-up Competition 2026
        &nbsp;·&nbsp; <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API docs ↗</a>
      </footer>
    </div>
  )
}
