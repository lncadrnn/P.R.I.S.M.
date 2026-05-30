import { useState, useRef } from 'react'
import { scan, fetchFromUrl } from '../api'
import styles from './SubmitForm.module.css'

export default function SubmitForm({ onResult, disabled }) {
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  function handleImage(file) {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleImage(e.dataTransfer.files[0])
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFetchUrl(e) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    setFetchError(null)
    setFetching(true)
    try {
      const data = await fetchFromUrl(trimmed)
      if (data.text) setText(data.text)
      if (data.image_url) {
        // Download image_url as a blob so it goes through the normal image flow
        const imgRes = await fetch(data.image_url)
        const blob = await imgRes.blob()
        const file = new File([blob], 'fetched-image.jpg', { type: blob.type || 'image/jpeg' })
        handleImage(file)
      }
      if (!data.text && !data.image_url) {
        setFetchError('No text or image found at that URL. Try a news article or public post.')
      }
    } catch (err) {
      setFetchError(err.message)
    } finally {
      setFetching(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim() && !imageFile) {
      setError('Add a caption, an image, or both.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const result = await scan({ text, imageFile })
      onResult(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = !disabled && !loading && (text.trim() || imageFile)

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.urlRow}>
        <input
          className={styles.urlInput}
          type="url"
          placeholder="Paste a URL to auto-fill text and image"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleFetchUrl(e)}
          disabled={fetching || disabled}
        />
        <button
          type="button"
          className={styles.urlBtn}
          onClick={handleFetchUrl}
          disabled={fetching || !url.trim() || disabled}
        >
          {fetching ? <span className={styles.spinnerSm} /> : 'Fetch'}
        </button>
      </div>
      {fetchError && <p className={styles.error}>{fetchError}</p>}

      <div className={styles.divider}><span>or fill in manually</span></div>

      <div className={styles.field}>
        <label className={styles.label}>Caption / Text</label>
        <textarea
          className={styles.textarea}
          placeholder="Paste a social media caption here (Taglish or English)"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Image</label>
        <div
          className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${imagePreview ? styles.hasImage : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !imagePreview && fileRef.current?.click()}
        >
          {imagePreview ? (
            <div className={styles.previewWrap}>
              <img src={imagePreview} className={styles.preview} alt="preview" />
              <button type="button" className={styles.clearBtn} onClick={e => { e.stopPropagation(); clearImage() }}>
                Remove
              </button>
            </div>
          ) : (
            <div className={styles.dropHint}>
              <span className={styles.dropIconText}>Upload</span>
              <span>Drag and drop an image or <u>click to browse</u></span>
              <span className={styles.dropSub}>JPG, PNG, WEBP</span>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.hidden}
          onChange={e => handleImage(e.target.files[0])}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {disabled && (
        <p className={styles.warning}>API is offline. Start the server with <code>python main.py</code> in <code>api/</code></p>
      )}

      <button type="submit" className={styles.submit} disabled={!canSubmit}>
        {loading ? <span className={styles.spinner} /> : null}
        {loading ? 'Scanning...' : 'Scan for Disinformation'}
      </button>
    </form>
  )
}
