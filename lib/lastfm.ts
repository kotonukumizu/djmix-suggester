const API_KEY = process.env.LASTFM_API_KEY!
const BASE = 'https://ws.audioscrobbler.com/2.0/'

export interface LastfmTrack {
  name: string
  artist: { name: string }
  match: string
}

export async function getSimilarTracks(
  artist: string,
  track: string,
  limit = 30
): Promise<LastfmTrack[]> {
  const url = new URL(BASE)
  url.searchParams.set('method', 'track.getSimilar')
  url.searchParams.set('artist', artist)
  url.searchParams.set('track', track)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))

  const res = await fetch(url.toString())
  const data = await res.json()
  return data.similartracks?.track ?? []
}
