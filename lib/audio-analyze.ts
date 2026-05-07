// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AudioContext } = require('node-web-audio-api')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MusicTempo = require('music-tempo')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFT = require('fft.js')

// Krumhansl-Schmuckler pitch class profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const KEYS  = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

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
  const fft = new FFT(fftSize) as any
  const out = fft.createComplexArray()
  const chroma = new Array(12).fill(0)

  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    const frame = Array.from(samples.slice(start, start + fftSize))
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
    if (maj > bestScore) { bestScore = maj; bestKey = KEYS[root] }
    const min = pearsonCorr(rotated, MINOR)
    if (min > bestScore) { bestScore = min; bestKey = KEYS[root] + 'm' }
  }
  return bestKey
}

export async function analyzeAudioBuffer(
  arrayBuffer: ArrayBuffer
): Promise<{ bpm: number | null; key: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = new AudioContext() as any
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const samples: Float32Array = audioBuffer.getChannelData(0)

    const mt = new MusicTempo(samples)
    const bpm = mt.tempo > 0 ? Math.round(mt.tempo) : null

    const chroma = computeChroma(samples, audioBuffer.sampleRate)
    const key = detectKey(chroma)

    return { bpm, key }
  } finally {
    await ctx.close()
  }
}
