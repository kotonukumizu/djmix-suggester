// ─── iTunes Search API ────────────────────────────────────────────────────────
// 認証不要・商用利用可・Apple Music の楽曲カタログ全体を検索する
// https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/

interface ItunesResult {
  trackId: number
  trackName: string
  artistName: string
  artworkUrl100?: string
  previewUrl?: string
}

// algorithm.ts の SpotifyRaw 型と同一シェイプを返す（移行時の変更を最小化）
export interface TrackRaw {
  id: string
  name: string
  artists: { name: string }[]
  album: { images: { url: string }[] }
  preview_url: string | null
}

function toTrackRaw(t: ItunesResult): TrackRaw {
  return {
    id: String(t.trackId),
    name: t.trackName,
    artists: [{ name: t.artistName }],
    album: {
      images: t.artworkUrl100
        ? [{ url: t.artworkUrl100.replace('100x100bb', '600x600bb') }]
        : [],
    },
    preview_url: t.previewUrl ?? null,
  }
}

// サーバーセッション中のメモリキャッシュ（iTunesレートリミット対策）
const itunesCache = new Map<string, ItunesResult[]>()

async function itunesFetch(params: Record<string, string>): Promise<ItunesResult[]> {
  const url = new URL('https://itunes.apple.com/search')
  const merged = { media: 'music', entity: 'song', country: 'jp', ...params }
  Object.entries(merged).forEach(([k, v]) => url.searchParams.set(k, v))
  const cacheKey = url.toString()

  if (itunesCache.has(cacheKey)) return itunesCache.get(cacheKey)!

  try {
    const res = await fetch(url.toString())
    if (!res.ok) {
      console.error(`[iTunes] HTTP ${res.status} for ${params.term}`)
      return []
    }
    const data = await res.json()
    const results = (data.results ?? []) as ItunesResult[]
    console.log(`[iTunes] "${params.term}" → ${results.length}件`)
    itunesCache.set(cacheKey, results)
    return results
  } catch (e) {
    console.error(`[iTunes] fetch失敗:`, e)
    return []
  }
}

export async function searchTracks(query: string, limit = 5): Promise<TrackRaw[]> {
  const results = await itunesFetch({ term: query, limit: String(limit) })
  return results.map(toTrackRaw)
}

/**
 * Last.fm の類似曲候補を iTunes で照合する。
 * Spotify の `track:name artist:artist` 構文の代替。
 * 完全一致 → 曲名前方一致 → 先頭結果 の順でフォールバック。
 */
export async function searchTrackByNameArtist(
  name: string,
  artist: string,
): Promise<TrackRaw | null> {
  const results = await itunesFetch({ term: `${name} ${artist}`, limit: '8' })
  if (results.length === 0) return null

  const nl = name.toLowerCase()
  const al = artist.toLowerCase()

  const exact = results.find(
    (r) =>
      r.trackName.toLowerCase() === nl &&
      r.artistName.toLowerCase() === al,
  )
  if (exact) return toTrackRaw(exact)

  const nameArtistMatch = results.find(
    (r) =>
      r.trackName.toLowerCase().includes(nl) &&
      r.artistName.toLowerCase().includes(al),
  )
  if (nameArtistMatch) return toTrackRaw(nameArtistMatch)

  const nameMatch = results.find((r) => r.trackName.toLowerCase().includes(nl))
  if (nameMatch) return toTrackRaw(nameMatch)

  return toTrackRaw(results[0])
}
