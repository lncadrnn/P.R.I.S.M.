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

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.prism}>PRISM</span>
          <span className={styles.tagline}>Progressive Realtime Identification of Synthetic Media</span>
        </div>
        <div className={styles.status}>
          <span className={apiOnline === null ? styles.statusChecking : apiOnline ? styles.statusOnline : styles.statusOffline}>
            {apiOnline === null ? '● checking…' : apiOnline ? '● API online' : '● API offline'}
          </span>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.formSection}>
          <h2 className={styles.sectionTitle}>Submit Content</h2>
          <p className={styles.sectionSub}>
            Paste a social media caption, upload an image, or both. PRISM will run each through its forensic modules and return a credibility verdict.
          </p>
          <SubmitForm onResult={setResult} disabled={apiOnline === false} />
        </section>

        {result && (
          <section className={styles.resultSection}>
            <h2 className={styles.sectionTitle}>Forensic Verdict</h2>
            <VerdictCard result={result} />
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        PRISM · Mapúa University · Next Gen Start-up Competition 2026 ·{' '}
        <a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API docs</a>
      </footer>
    </div>
  )
}
