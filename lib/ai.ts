// ─── AI Bridge Suggestions ────────────────────────────────────────────────────
// Gemini に DJ の知識ベースとして「ブリッジ候補曲」を挙げてもらう。
// Last.fm（行動データ）では拾えない、音楽的文脈からの提案を補完する。
//
// 必要な環境変数: GOOGLE_AI_API_KEY
// 無料枠: Gemini 3.1 Flash Lite — 15 RPM / 500 RPD

// ─── グローバルレートリミッター（15 RPM対策）─────────────────────────────────
// 最低 MIN_INTERVAL_MS 間隔を確保してGemini呼び出しをシリアル化する
const MIN_INTERVAL_MS = 4500  // 60s / 15RPM = 4s + バッファ 0.5s
let lastCallTime = 0

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastCallTime
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  lastCallTime = Date.now()
}

export interface AISuggestion {
  name: string
  artist: string
  bpmEstimate: number | null
}

interface TrackInfo {
  name: string
  artist: string
  bpm: number | null
  camelot: string | null
}

/**
 * 2曲の間に挟むブリッジ曲を Gemini に提案させる。
 * - 失敗（APIエラー・タイムアウト・JSON不正）は空配列を返す（サイレントフォールバック）
 * - targetBpm が分かっている場合はプロンプトに含めてより精度の高い提案を得る
 * - bpmEstimate が目標BPMから大きく外れる提案は呼び出し側でフィルタリングされる
 */
export async function getLLMBridgeSuggestions(
  trackA: TrackInfo,
  trackB: TrackInfo,
  targetBpm: number | null,
  count = 5,
): Promise<AISuggestion[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return []

  const fmtTrack = (t: TrackInfo) => {
    const meta: string[] = []
    if (t.bpm)     meta.push(`${t.bpm} BPM`)
    if (t.camelot) meta.push(`key ${t.camelot}`)
    return `"${t.name}" by ${t.artist}${meta.length ? ` (${meta.join(', ')})` : ''}`
  }

  let bpmSection: string
  if (targetBpm) {
    const target = Math.round(targetBpm)
    const half   = Math.round(targetBpm / 2)
    const dbl    = Math.round(targetBpm * 2)
    bpmSection = `\
Target bridge BPM: ${target} BPM
  Acceptable BPM range: ${Math.round(target * 0.98)}–${Math.round(target * 1.02)} BPM
  Half-tempo equivalent: ${half} BPM (range ${Math.round(half * 0.98)}–${Math.round(half * 1.02)} BPM)
  Double-tempo equivalent: ${dbl} BPM (range ${Math.round(dbl * 0.98)}–${Math.round(dbl * 1.02)} BPM)
A track qualifies if its actual BPM falls within ANY of the three ranges above.`
  } else {
    bpmSection = 'Target bridge BPM: unknown — prioritize genre and mood fit'
  }

  const prompt = `You are an expert DJ with deep knowledge of track BPMs and mixing. \
Your job is to suggest ${count} real, released tracks that bridge a DJ mix between:

Track A: ${fmtTrack(trackA)}
Track B: ${fmtTrack(trackB)}

${bpmSection}

Selection rules (strict):
1. BPM FIRST — only suggest tracks whose actual BPM you are confident falls within the acceptable ranges above. Reject any track where you are unsure of the BPM.
2. Genre / mood — bridges the sonic feel from A to B naturally
3. Mixability — the track is known to work in DJ sets

For each suggestion include your best BPM estimate (bpm_estimate). If you cannot confidently estimate the BPM, omit that track entirely.

Return ONLY valid JSON, no explanation:
{"tracks":[{"name":"...","artist":"...","bpm_estimate":128},{"name":"...","artist":"...","bpm_estimate":132}]}`

  const callGemini = async () => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(12000),
    },
  )

  try {
    await waitForRateLimit()
    let res = await callGemini()

    // 429 Rate Limit → 10秒待ってリトライ1回
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 10000))
      lastCallTime = Date.now()
      res = await callGemini()
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[AI] Gemini APIエラー ${res.status}:`, errText.slice(0, 300))
      return []
    }

    const data = await res.json()
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    console.log(`[AI] Geminiレスポンス:\n${text}`)

    // レスポンス内の JSON ブロックを抽出（前後に余分なテキストがある場合に対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []

    const parsed: { tracks?: { name?: string; artist?: string; bpm_estimate?: number }[] } = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.tracks)) return []

    return parsed.tracks
      .filter((t) => typeof t.name === 'string' && typeof t.artist === 'string')
      .map((t) => ({
        name: t.name!,
        artist: t.artist!,
        bpmEstimate: typeof t.bpm_estimate === 'number' ? t.bpm_estimate : null,
      }))
      .slice(0, count)
  } catch (e) {
    console.error('[AI] Gemini例外:', e)
    return []
  }
}
