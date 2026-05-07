const KEY_TO_CAMELOT: Record<string, string> = {
  'C': '8B', 'Am': '8A',
  'G': '9B', 'Em': '9A',
  'D': '10B', 'Bm': '10A',
  'A': '11B', 'F#m': '11A', 'Gbm': '11A',
  'E': '12B', 'C#m': '12A', 'Dbm': '12A',
  'B': '1B', 'G#m': '1A', 'Abm': '1A',
  'F#': '2B', 'Gb': '2B', 'D#m': '2A', 'Ebm': '2A',
  'Db': '3B', 'C#': '3B', 'A#m': '3A', 'Bbm': '3A',
  'Ab': '4B', 'G#': '4B', 'Fm': '4A',
  'Eb': '5B', 'D#': '5B', 'Cm': '5A',
  'Bb': '6B', 'A#': '6B', 'Gm': '6A',
  'F': '7B', 'Dm': '7A',
}

export function toCamelot(key: string | null | undefined): string | null {
  if (!key) return null
  const k = key.trim().replace(/\s*(major|maj)\s*/i, '').replace(/\s*(minor|min)\s*/i, 'm')
  return KEY_TO_CAMELOT[k] ?? KEY_TO_CAMELOT[key.trim()] ?? null
}

export const CAMELOT_COLORS: Record<number, string> = {
  1: '#ef4444', 2: '#f97316', 3: '#f59e0b', 4: '#eab308',
  5: '#84cc16', 6: '#22c55e', 7: '#14b8a6', 8: '#06b6d4',
  9: '#3b82f6', 10: '#6366f1', 11: '#8b5cf6', 12: '#d946ef',
}

export function camelotColor(camelot: string | null): string {
  if (!camelot) return '#4b5563'
  const n = parseInt(camelot)
  return CAMELOT_COLORS[n] ?? '#4b5563'
}

export type Compatibility = 'perfect' | 'good' | 'ok' | 'poor' | 'unknown'

export function camelotCompatibility(a: string | null, b: string | null): Compatibility {
  if (!a || !b) return 'unknown'
  const nA = parseInt(a), lA = a.slice(-1)
  const nB = parseInt(b), lB = b.slice(-1)
  if (nA === nB && lA === lB) return 'perfect'
  if (nA === nB) return 'good'
  const diff = Math.min(Math.abs(nA - nB), 12 - Math.abs(nA - nB))
  if (diff === 1 && lA === lB) return 'good'
  if (diff === 1) return 'ok'
  if (diff === 2) return 'ok'
  return 'poor'
}

export function compatibilityScore(a: string | null, b: string | null): number {
  const map: Record<Compatibility, number> = { perfect: 1, good: 0.85, ok: 0.55, poor: 0.2, unknown: 0.4 }
  return map[camelotCompatibility(a, b)]
}
