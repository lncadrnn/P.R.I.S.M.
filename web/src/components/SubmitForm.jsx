import { useState, useRef } from 'react'
import { scan } from '../api'
import styles from './SubmitForm.module.css'

export default function SubmitForm({ onResult, disabled }) {
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

  function openPicker() {
    if (!imagePreview) fileRef.current?.click()
  }

  function onDropzoneKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
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
      <div className={styles.field}>
        <label className={styles.label} htmlFor="prism-caption">Caption / Text</label>
        <textarea
          id="prism-caption"
          className={styles.textarea}
          placeholder="Paste a social media caption here (Taglish or English)"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="prism-image">Image</label>
        <div
          className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${imagePreview ? styles.hasImage : ''}`}
          role="button"
          tabIndex={imagePreview ? -1 : 0}
          aria-label="Upload an image: drag and drop, or activate to browse files"
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={openPicker}
          onKeyDown={onDropzoneKeyDown}
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
          id="prism-image"
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
