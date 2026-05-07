export interface Track {
  spotifyId: string
  name: string
  artist: string
  albumArt: string | null
  previewUrl: string | null
  bpm: number | null
  camelot: string | null
  isBridge: boolean
  matchScore?: number
  isAiSuggested?: boolean   // Gemini提案由来の候補
  candidates?: Track[]      // ブリッジ候補の代替曲（isBridgeのみ）
  targetBpm?: number | null // このブリッジが目標とするBPM（クライアント選択に使用）
}
