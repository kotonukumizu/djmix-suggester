import { Track } from '@/types'
import { getSimilarTracks, LastfmTrack } from './lastfm'
import { searchTrackByNameArtist } from './itunes'
import { analyzePreview } from './analyze'
import { compatibilityScore } from './camelot'
import { getLLMBridgeSuggestions } from './ai'

// ─── 実験フラグ ────────────────────────────────────────────────────────────────
// true: ブリッジ候補をAI提案のみに限定（Last.fmをスキップ）
// false: 通常動作（Last.fm + AI）
const AI_ONLY_BRIDGES = false

interface SpotifyRaw {
  id: string
  name: string
  artists: { name: string }[]
  album: { images: { url: string }[] }
  preview_url: string | null
}

function fromSpotify(t: SpotifyRaw, isBridge: boolean, matchScore?: number, isAi?: boolean): Track {
  return {
    spotifyId: t.id,
    name: t.name,
    artist: t.artists?.[0]?.name ?? '',
    albumArt: t.album?.images?.[0]?.url ?? null,
    previewUrl: t.preview_url ?? null,
    bpm: null,
    camelot: null,
    isBridge,
    matchScore,
    ...(isAi ? { isAiSuggested: true } : {}),
  }
}

async function enrich(track: Track): Promise<Track> {
  // BPMがクライアント側で取得済みの場合はスキップ（iTunesプレビューの上書き防止）
  if (!track.previewUrl || track.bpm != null) return track
  const { bpm, camelot } = await analyzePreview(track.previewUrl)
  return { ...track, bpm, camelot }
}

// ─── BPM helpers ──────────────────────────────────────────────────────────────

/**
 * Effective BPM distance considering double/half-tempo equivalence.
 *
 * Considers five comparisons: direct | a×2 vs b | a vs b×2 | a÷2 vs b | a vs b÷2
 * and returns the minimum.
 *
 * Examples:
 *   effectiveBpmDiff(101, 179) → min(78, |202-179|=23, 257, |50.5-179|=128.5, |101-89.5|=11.5) = 11.5
 *   effectiveBpmDiff(70, 130)  → min(60, |140-130|=10, 190, |35-130|=95, |70-65|=5) = 5
 *   effectiveBpmDiff(100, 200) → min(100, 0, ...) = 0
 *   effectiveBpmDiff(120, 140) → min(20, 100, 260, 80, 50) = 20
 */
export function effectiveBpmDiff(a: number, b: number): number {
  return Math.min(
    Math.abs(a - b),
    Math.abs(a * 2 - b),
    Math.abs(a - b * 2),
    Math.abs(a / 2 - b),
    Math.abs(a - b / 2),
  )
}

/**
 * Find which double/half representation of a and b minimizes the BPM diff.
 * Both the bridge count and the bridge target BPMs are computed from this pair.
 *
 * Considers five options:
 *   [a,   b]   direct
 *   [a×2, b]   double A
 *   [a,   b×2] double B
 *   [a÷2, b]   half A
 *   [a,   b÷2] half B  ← fixes 101→179: [101, 89.5] diff=11.5 (was missing before)
 *
 * Example: findClosestPair(101, 179) → [101, 89.5]  diff=11.5 → 1 bridge at ~95 BPM
 * Example: findClosestPair(70,  130) → [70,  65]    diff=5    → 0 bridges
 * Example: findClosestPair(120, 140) → [120, 140]   diff=20   → 2 bridges
 */
function findClosestPair(a: number, b: number): [number, number] {
  const options: [number, number][] = [
    [a,     b    ],
    [a * 2, b    ],
    [a,     b * 2],
    [a / 2, b    ],
    [a,     b / 2],
  ]
  return options.reduce((best, opt) =>
    Math.abs(opt[0] - opt[1]) < Math.abs(best[0] - best[1]) ? opt : best
  )
}

/**
 * Intermediate BPM targets for stepping from `from` to `to`.
 * e.g. bpmSteps(100, 120, 2) → [107, 113]  (equal spacing inside the range)
 */
function bpmSteps(from: number, to: number, count: number): number[] {
  const steps: number[] = []
  for (let i = 1; i <= count; i++) {
    steps.push(from + (to - from) * (i / (count + 1)))
  }
  return steps
}

/**
 * How many bridge tracks to insert, given an acceptable BPM step `threshold`.
 *
 * Rule: floor(diff / threshold), capped at 3.
 * Default threshold = 7.
 *
 *   diff < threshold → 0 bridges  (no bridge needed)
 *   diff ∈ [threshold, 2×threshold) → 1 bridge
 *   diff ∈ [2×threshold, 3×threshold) → 2 bridges
 *   diff ≥ 3×threshold → 3 bridges  (capped)
 */
function bridgesNeeded(diff: number, threshold = 7): number {
  return Math.min(3, Math.floor(diff / threshold))
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Score a pair for ordering purposes.
 * BPM is the decisive dimension (weight 0.85); Camelot is a tiebreaker (0.15).
 *
 * BPM scoring: ≤10 effective diff is the hard target.
 *   0 diff → 1.0 | 5 diff → 0.75 | 10 diff → 0.5 | 20 diff → 0
 */
function pairScore(a: Track, b: Track): number {
  let bpmScore = 0.3 // neutral when BPM unknown
  if (a.bpm && b.bpm) {
    const diff = effectiveBpmDiff(a.bpm, b.bpm)
    bpmScore = Math.max(0, 1 - diff / 20)
  }
  const camelotScore = compatibilityScore(a.camelot, b.camelot)
  return bpmScore * 0.85 + camelotScore * 0.15
}

/**
 * Greedy nearest-neighbor ordering using effective BPM distance (double/half-tempo aware).
 *
 * e.g. [70, 120, 120, 140] → [120, 120, 140, 70]
 *   because 140→70 has effective diff 0 (70=140 at double/half tempo),
 *   so placing 70 at the end gives the smoothest total BPM journey.
 *
 * Algorithm:
 *   1. Tracks with known BPM are ordered by greedy NN with effectiveBpmDiff.
 *   2. We try every track as the starting point and keep the sequence with
 *      the minimum total effective BPM travel.
 *   3. Tracks without BPM are appended at the end.
 */
function optimizeOrder(tracks: Track[]): Track[] {
  if (tracks.length <= 1) return tracks

  const withBpm = tracks.filter((t) => t.bpm != null)
  const noBpm = tracks.filter((t) => t.bpm == null)

  if (withBpm.length === 0) return tracks

  /** Run greedy NN from a given start index, return [sequence, totalDiff] */
  function greedyFrom(startIdx: number): [Track[], number] {
    const remaining = [...withBpm]
    const seq = [remaining.splice(startIdx, 1)[0]]
    let total = 0
    while (remaining.length > 0) {
      const last = seq[seq.length - 1]
      let bestI = 0
      let bestDiff = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const d = effectiveBpmDiff(last.bpm!, remaining[i].bpm!)
        if (d < bestDiff) { bestDiff = d; bestI = i }
      }
      total += bestDiff
      seq.push(remaining.splice(bestI, 1)[0])
    }
    return [seq, total]
  }

  // Try every starting point; keep the sequence with minimum total BPM travel
  let bestSeq = withBpm
  let bestTotal = Infinity
  for (let i = 0; i < withBpm.length; i++) {
    const [seq, total] = greedyFrom(i)
    if (total < bestTotal) { bestTotal = total; bestSeq = seq }
  }

  return [...bestSeq, ...noBpm]
}

// ─── Bridge finding ───────────────────────────────────────────────────────────

interface RawCandidate {
  id: string
  track: SpotifyRaw
  lastfmScore: number
  isAi?: boolean
}

/**
 * Build a pool of Spotify candidates sourced from Last.fm similarity.
 * Prefers tracks that appear in *both* simA and simB (intersection).
 */
async function buildCandidatePool(
  trackA: Track,
  trackB: Track | null,  // null when track B unknown (single-track mode)
  usedIds: Set<string>,
  poolSize = 20,
): Promise<RawCandidate[]> {
  const simA = await getSimilarTracks(trackA.artist, trackA.name, 50)
  const simB = trackB ? await getSimilarTracks(trackB.artist, trackB.name, 50) : []

  const mapA = new Map<string, LastfmTrack>(
    simA.map((t) => [`${t.name.toLowerCase()}::${t.artist.name.toLowerCase()}`, t])
  )
  const mapB = new Map<string, LastfmTrack>(
    simB.map((t) => [`${t.name.toLowerCase()}::${t.artist.name.toLowerCase()}`, t])
  )

  // Intersection first
  type NL = { score: number; name: string; artist: string }
  const intersect: NL[] = []
  for (const [key, tA] of mapA) {
    if (mapB.has(key)) {
      const tB = mapB.get(key)!
      intersect.push({
        score: (parseFloat(tA.match) + parseFloat(tB.match)) / 2,
        name: tA.name,
        artist: tA.artist.name,
      })
    }
  }

  const nameList: NL[] =
    intersect.length > 0
      ? intersect.sort((a, b) => b.score - a.score)
      : [...simA, ...simB].slice(0, 30).map((t) => ({
          score: parseFloat(t.match),
          name: t.name,
          artist: t.artist.name,
        }))

  // Search Spotify for each candidate; stop once we have `poolSize` tracks
  const pool: RawCandidate[] = []
  for (const nl of nameList) {
    if (pool.length >= poolSize) break
    const found = await searchTrackByNameArtist(nl.name, nl.artist)
    if (!found || usedIds.has(found.id)) continue
    pool.push({ id: found.id, track: found as SpotifyRaw, lastfmScore: nl.score })
  }
  return pool
}

/**
 * Main bridge-finding function.
 *
 * When both A and B have BPM:
 *   - Computes how many bridges are needed (1–3) based on effective BPM gap
 *   - Computes intermediate BPM targets evenly spaced between A.bpm and B.bpm (normalized)
 *   - For each slot, assigns primary (index 0) + up to 4 alternatives
 *   - Sets bridge.targetBpm and bridge.candidates for client-side BPM optimization
 *
 * When BPM is missing: falls back to 1 bridge with targetBpm=null.
 */
const ALTERNATIVES_PER_BRIDGE = 8

async function findBridges(
  trackA: Track,
  trackB: Track,
  usedIds: Set<string>,
  bpmTolerance = 7,
  skipAI = false,  // true: Last.fmのみ使用（ギャップ補完パス用）
): Promise<Track[]> {
  const aBpm = trackA.bpm
  const bBpm = trackB.bpm

  // ── Case 1: BPM known for both tracks ─────────────────────────────────────
  if (aBpm && bBpm) {
    const [aNorm, bNorm] = findClosestPair(aBpm, bBpm)
    const diff = Math.abs(aNorm - bNorm)
    const count = bridgesNeeded(diff, bpmTolerance)

    // BPM差が閾値以内なら不要 — Last.fm/Spotifyを呼ばず即リターン
    if (count === 0) return []

    // ターゲットは正規化ペア間のステップ。
    // 例: 101→179 → findClosestPair → [101, 89.5], bpmSteps(101, 89.5, 1) → [95.25]
    // 例: 120→140 → findClosestPair → [120, 140],  bpmSteps(120, 140, 2) → [127, 133]
    const targetBpms = bpmSteps(aNorm, bNorm, count)

    // Pool must be large enough for primary + alternatives per slot
    const slotSize = 1 + ALTERNATIVES_PER_BRIDGE
    const poolSize = count * slotSize + 5  // a few extras

    // Last.fm候補とLLM候補を並列取得（LLMはタイムアウト or 失敗でも空配列を返す）
    const avgTargetBpm = targetBpms.reduce((s, v) => s + v, 0) / targetBpms.length

    // skipAI=trueまたはAI_ONLY_BRIDGES=trueの場合はLast.fmのみ or AIのみ
    const useAI = !skipAI
    const [lastfmPool, llmSuggestions] = await Promise.all([
      (AI_ONLY_BRIDGES && useAI) ? Promise.resolve([]) : buildCandidatePool(trackA, trackB, usedIds, poolSize),
      useAI ? getLLMBridgeSuggestions(
        { name: trackA.name, artist: trackA.artist, bpm: trackA.bpm, camelot: trackA.camelot },
        { name: trackB.name, artist: trackB.artist, bpm: trackB.bpm, camelot: trackB.camelot },
        avgTargetBpm,
        6,
      ) : Promise.resolve([]),
    ])
    const pool = lastfmPool

    // LLM提案曲をiTunesで検索してプールに追加（重複・使用済みは除外）
    // bpmEstimateが目標BPMから±12%以上外れる提案はiTunes検索前にスキップ
    const bpmFilteredSuggestions = llmSuggestions.filter((s) => {
      if (!s.bpmEstimate || !avgTargetBpm) return true  // BPM不明なら通す
      const est = s.bpmEstimate
      const target = avgTargetBpm
      // direct / half / double の3パターンで±12%以内かチェック
      const within = (x: number) => Math.abs(x - target) / target <= 0.02
      const passes = within(est) || within(est * 2) || within(est / 2)
      if (!passes) {
        console.log(`[AI] BPMフィルタ除外: "${s.name}" by ${s.artist} (推定${Math.round(est)} BPM, 目標${Math.round(target)} BPM)`)
      }
      return passes
    })
    console.log(`[AI] Gemini提案: ${llmSuggestions.length}曲 → BPMフィルタ後: ${bpmFilteredSuggestions.length}曲`, bpmFilteredSuggestions.map((s) => `${s.name} / ${s.artist} (~${s.bpmEstimate ?? '?'} BPM)`))
    const existingIds = new Set([...pool.map((c) => c.id), ...usedIds])
    let aiAdded = 0
    for (const s of bpmFilteredSuggestions) {
      const found = await searchTrackByNameArtist(s.name, s.artist)
      if (!found || existingIds.has(found.id)) continue
      pool.push({ id: found.id, track: found as SpotifyRaw, lastfmScore: 0.6, isAi: true })
      existingIds.add(found.id)
      aiAdded++
    }
    console.log(`[AI] プールに追加: ${aiAdded}曲 / Last.fm: ${pool.length - aiAdded}曲`)

    // AI_ONLY_BRIDGES でAIが0件の場合はLast.fmにフォールバック
    if (useAI && AI_ONLY_BRIDGES && pool.length === 0) {
      console.log('[AI] AI提案0件のためLast.fmにフォールバック')
      const fallbackPool = await buildCandidatePool(trackA, trackB, usedIds, poolSize)
      pool.push(...fallbackPool)
    }

    if (pool.length === 0) return []

    const bridges: Track[] = []
    const localUsed = new Set<string>()

    for (let i = 0; i < targetBpms.length; i++) {
      const targetBpm = targetBpms[i]

      // Pick primary (first available in pool not yet used)
      const available = pool.filter(c => !localUsed.has(c.id))
      if (available.length === 0) break

      const primary = available[0]
      const bridge = fromSpotify(primary.track, true, primary.lastfmScore, primary.isAi)
      bridge.targetBpm = targetBpm
      localUsed.add(primary.id)
      usedIds.add(primary.id)

      // Pick alternatives (next up to ALTERNATIVES_PER_BRIDGE not yet used)
      const altCandidates = available.slice(1, 1 + ALTERNATIVES_PER_BRIDGE)
      bridge.candidates = altCandidates.map(c => fromSpotify(c.track, true, c.lastfmScore, c.isAi))
      for (const c of altCandidates) {
        localUsed.add(c.id)
        usedIds.add(c.id)
      }

      bridges.push(bridge)
    }

    return bridges
  }

  // ── Case 2: 片方または両方のBPM不明 ──────────────────────────────────────
  // BPMが分からない場合はブリッジが必要かどうか判断できないため、
  // ジャンル/雰囲気の橋渡しとして1曲だけ挿入する。
  // ただし片方だけ null の場合（解析失敗）は差を推定できないので同様に1曲。
  const pool = await buildCandidatePool(trackA, trackB, usedIds, 10)
  if (pool.length === 0) return []

  const first = pool[0]
  const bridge = fromSpotify(first.track, true, first.lastfmScore, first.isAi)
  bridge.targetBpm = null
  usedIds.add(first.id)
  return [bridge]
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildSuggestedPlaylist(inputTracks: Track[], bpmTolerance = 7, maxSuggestions = 10): Promise<Track[]> {
  if (inputTracks.length === 0) return []

  // Server-side enrich (grabs BPM/camelot if Spotify preview_url exists;
  // in practice preview_url is null, so client-supplied BPM passes through unchanged)
  const enriched = await Promise.all(inputTracks.map(enrich))

  // ── Single track: return similar tracks ───────────────────────────────────
  if (enriched.length === 1) {
    const usedIds = new Set([enriched[0].spotifyId])
    // Fetch enough candidates to fill the requested maxSuggestions
    const pool = await buildCandidatePool(enriched[0], null, usedIds, maxSuggestions + 5)

    const result: Track[] = [enriched[0]]
    for (const c of pool) {
      if (result.length >= maxSuggestions + 1) break
      const bridge = fromSpotify(c.track, true, c.lastfmScore, c.isAi)
      bridge.targetBpm = null
      result.push(bridge)
      usedIds.add(c.id)
    }

    return result
  }

  // ── Multi-track: sort by BPM → insert bridges ─────────────────────────────
  const ordered = optimizeOrder(enriched)
  const usedIds = new Set(ordered.map((t) => t.spotifyId))

  const result: Track[] = []
  for (let i = 0; i < ordered.length; i++) {
    result.push(ordered[i])
    if (i < ordered.length - 1) {
      const bridges = await findBridges(ordered[i], ordered[i + 1], usedIds, bpmTolerance)
      result.push(...bridges)
    }
  }

  // ── ギャップ補完パス（Last.fmのみ、最大2回）────────────────────────────────
  // ブリッジ挿入後も隣接ペアのBPM差がtoleranceを超えている場合に追加ブリッジを挿入
  const MAX_FILL_PASSES = 2
  for (let pass = 0; pass < MAX_FILL_PASSES; pass++) {
    let filled = false
    const next: Track[] = []
    for (let i = 0; i < result.length; i++) {
      next.push(result[i])
      if (i < result.length - 1) {
        const a = result[i], b = result[i + 1]
        if (a.bpm != null && b.bpm != null) {
          const [aN, bN] = findClosestPair(a.bpm, b.bpm)
          if (Math.abs(aN - bN) > bpmTolerance) {
            const extra = await findBridges(a, b, usedIds, bpmTolerance, true /* skipAI */)
            if (extra.length > 0) {
              next.push(...extra)
              filled = true
            }
          }
        }
      }
    }
    result.splice(0, result.length, ...next)
    if (!filled) break
  }

  return result
}

// Suppress unused import warning — pairScore uses compatibilityScore indirectly via camelot
void pairScore
