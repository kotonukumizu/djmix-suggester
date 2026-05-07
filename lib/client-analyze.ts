import MusicTempo from 'music-tempo'
import FFT from 'fft.js'
import { toCamelot } from './camelot'

// Krumhansl-Schmuckler profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function pearsonCorr(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const dA = a[i] - ma, dB = b[i] - mb
    num += dA * dB; da += dA * dA; db += dB * dB
  }
  const denom = Math.sqrt(da * db)
  return denom === 0 ? 0 : num / denom
}

function computeChroma(samples: Float32Array, sampleRate: number): number[] {
  const fftSize = 4096
  const hopSize = 2048
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fft = new (FFT as any)(fftSize)
  const out = fft.createComplexArray()
  const chroma = new Array(12).fill(0)

  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    const frame = new Float64Array(samples.slice(start, start + fftSize))
    fft.realTransform(out, frame)
    const freqRes = sampleRate / fftSize
    for (let pc = 0; pc < 12; pc++) {
      for (let oct = 2; oct <= 6; oct++) {
        const freq = 261.63 * Math.pow(2, oct - 4 + pc / 12)
        const bin = Math.round(freq / freqRes)
        if (bin > 0 && bin * 2 + 1 < out.length) {
          chroma[pc] += Math.sqrt(out[bin * 2] ** 2 + out[bin * 2 + 1] ** 2)
        }
      }
    }
  }

  const max = Math.max(...chroma)
  return max > 0 ? chroma.map((v: number) => v / max) : chroma
}

function detectKey(chroma: number[]): string {
  let bestKey = 'C', bestScore = -Infinity
  for (let root = 0; root < 12; root++) {
    const rotated = [...chroma.slice(root), ...chroma.slice(0, root)]
    const maj = pearsonCorr(rotated, MAJOR)
    if (maj > bestScore) { bestScore = maj; bestKey = KEY_NAMES[root] }
    const min = pearsonCorr(rotated, MINOR)
    if (min > bestScore) { bestScore = min; bestKey = KEY_NAMES[root] + 'm' }
  }
  return bestKey
}

// DJ向けBPM正規化: ほとんどのダンスミュージックは80〜175 BPMに収まる。
// 範囲外の場合、×2 または ÷2 した値が範囲内に入るなら補正する。
// 例: 65 BPM → 130 BPM, 155 BPM はそのまま, 40 BPM → 80 BPM
function normalizeToDanceRange(bpm: number): number {
  const MIN = 80, MAX = 175
  if (bpm >= MIN && bpm <= MAX) return bpm
  if (bpm * 2 >= MIN && bpm * 2 <= MAX) return bpm * 2
  if (bpm / 2 >= MIN && bpm / 2 <= MAX) return bpm / 2
  return bpm  // スロー/エクスペリメンタルなど: そのまま返す
}

// スペクトルフラックス + Hann窓によるオンセット強度計算でオートコリレーションBPM検出。
// 旧RMS法より拍頭の検出精度が高い。
function detectBpmAutocorr(samples: Float32Array, sampleRate: number): number | null {
  const fftSize = 1024
  const hopSize = 512
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fft = new (FFT as any)(fftSize)
  const out = fft.createComplexArray()

  // Hann窓係数（フレームごとに共通利用）
  const hann = new Float64Array(fftSize)
  for (let j = 0; j < fftSize; j++) hann[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (fftSize - 1))

  // 各フレームのスペクトル振幅を計算
  const frames: Float32Array[] = []
  for (let i = 0; i + fftSize <= samples.length; i += hopSize) {
    const frame = new Float64Array(fftSize)
    for (let j = 0; j < fftSize; j++) frame[j] = samples[i + j] * hann[j]
    fft.realTransform(out, frame)
    const mag = new Float32Array(fftSize / 2)
    for (let j = 0; j < fftSize / 2; j++) {
      mag[j] = Math.sqrt(out[j * 2] ** 2 + out[j * 2 + 1] ** 2)
    }
    frames.push(mag)
  }

  // スペクトルフラックス（正のスペクトル変化量 = オンセット強度）
  const onsets: number[] = [0]
  for (let i = 1; i < frames.length; i++) {
    let flux = 0
    for (let j = 0; j < frames[i].length; j++) {
      const diff = frames[i][j] - frames[i - 1][j]
      if (diff > 0) flux += diff
    }
    onsets.push(flux)
  }

  const hopDur = hopSize / sampleRate
  const minLag = Math.max(1, Math.floor(60 / (200 * hopDur)))
  const maxLag = Math.ceil(60 / (60 * hopDur))

  let bestLag = minLag, bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    const n = onsets.length - lag
    for (let i = 0; i < n; i++) corr += onsets[i] * onsets[i + lag]
    corr /= n
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  const bpm = 60 / (bestLag * hopDur)
  return bpm > 40 && bpm < 220 ? Math.round(bpm) : null
}

// 2手法のBPMを照合し最良値を返す。
// ダブル/ハーフテンポのズレは normalizeToDanceRange で解消してから比較する。
function crossValidateBpm(b1: number | null, b2: number | null): number | null {
  if (!b1 && !b2) return null
  if (!b1) return b2 ? Math.round(normalizeToDanceRange(b2)) : null
  if (!b2) return Math.round(normalizeToDanceRange(b1))

  // 正規化前に直接比較: 3%以内なら平均
  if (Math.abs(b1 - b2) / Math.max(b1, b2) <= 0.03) return Math.round((b1 + b2) / 2)

  // 正規化してから再比較: ダブル/ハーフのズレをここで吸収
  const n1 = normalizeToDanceRange(b1)
  const n2 = normalizeToDanceRange(b2)
  if (Math.abs(n1 - n2) / Math.max(n1, n2) <= 0.05) return Math.round((n1 + n2) / 2)

  // 不一致 → Beatroot (b1) の正規化値を優先
  return Math.round(n1)
}

let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return sharedCtx
}

export async function analyzeTrack(
  spotifyId: string,
  artist: string,
  title: string,
  previewUrl?: string | null,
): Promise<{ spotifyId: string; bpm: number | null; camelot: string | null }> {
  // previewUrl が渡されていればそのまま使用。なければ Deezer から取得（フォールバック）
  let preview: string | null = previewUrl ?? null
  if (!preview) {
    const pvRes = await fetch(
      `/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
    )
    const data = await pvRes.json()
    preview = data.preview ?? null
  }
  if (!preview) return { spotifyId, bpm: null, camelot: null }

  // プロキシ経由で音声を取得
  const audioRes = await fetch(`/api/proxy?url=${encodeURIComponent(preview)}`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!audioRes.ok) return { spotifyId, bpm: null, camelot: null }

  const arrayBuffer = await audioRes.arrayBuffer()

  // ブラウザのネイティブ AudioContext で MP3 デコード
  const ctx = getCtx()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
  const samples = audioBuffer.getChannelData(0)

  // BPM: Beatroot + Autocorrelation の2手法で照合
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mt = new (MusicTempo as any)(samples)
  const bpmBeatroot = mt.tempo > 0 ? Math.round(mt.tempo) : null
  const bpmAutocorr = detectBpmAutocorr(samples, audioBuffer.sampleRate)
  const bpm = crossValidateBpm(bpmBeatroot, bpmAutocorr)

  // Key → Camelot
  const chroma = computeChroma(samples, audioBuffer.sampleRate)
  const key = detectKey(chroma)
  const camelot = toCamelot(key)

  return { spotifyId, bpm, camelot }
}
