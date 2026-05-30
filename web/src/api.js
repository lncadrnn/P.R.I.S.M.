const BASE = ''  // proxied through Vite → http://127.0.0.1:8000

export async function checkHealth() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error('API unreachable')
  return res.json()
}

export async function scan({ text, imageFile }) {
  const form = new FormData()
  if (imageFile) form.append('image', imageFile)
  if (text?.trim()) form.append('text', text.trim())

  const res = await fetch(`${BASE}/scan`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Server error ${res.status}`)
  }
  return res.json()
}
