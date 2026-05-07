export async function getDeezerPreview(artist: string, title: string): Promise<string | null> {
  try {
    const q = `${title} ${artist}`
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=3`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    const tracks: { title: string; artist: { name: string }; preview: string }[] = data.data ?? []
    if (tracks.length === 0) return null

    // タイトルが最も近いものを選ぶ
    const titleLower = title.toLowerCase()
    const sorted = tracks.sort((a, b) => {
      const dA = a.title.toLowerCase().includes(titleLower) ? 0 : 1
      const dB = b.title.toLowerCase().includes(titleLower) ? 0 : 1
      return dA - dB
    })
    return sorted[0].preview || null
  } catch {
    return null
  }
}
