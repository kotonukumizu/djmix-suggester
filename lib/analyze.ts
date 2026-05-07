import { parseBuffer } from 'music-metadata'
import { toCamelot } from './camelot'

const cache = new Map<string, { bpm: number | null; camelot: string | null }>()

export async function analyzePreview(
  previewUrl: string
): Promise<{ bpm: number | null; camelot: string | null }> {
  if (cache.has(previewUrl)) return cache.get(previewUrl)!

  try {
    const res = await fetch(previewUrl, { signal: AbortSignal.timeout(8000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const meta = await parseBuffer(buf, { mimeType: 'audio/mpeg' })
    const result = {
      bpm: meta.common.bpm ? Math.round(meta.common.bpm) : null,
      camelot: toCamelot(meta.common.key ?? null),
    }
    cache.set(previewUrl, result)
    return result
  } catch {
    return { bpm: null, camelot: null }
  }
}
