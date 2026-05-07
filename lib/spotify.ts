const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

let accessToken: string | null = null
let tokenExpiry = 0

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  })

  const data = await res.json()
  accessToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return accessToken!
}

async function spotifyFetch(path: string) {
  const token = await getAccessToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json()
}

export async function searchTracks(query: string) {
  const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=5`)
  return data.tracks?.items ?? []
}

export async function getTrack(id: string) {
  return spotifyFetch(`/tracks/${id}`)
}

export async function searchTrackByNameArtist(name: string, artist: string) {
  const query = `track:${name} artist:${artist}`
  const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`)
  return data.tracks?.items?.[0] ?? null
}

export async function getPlaylistTracks(playlistId: string) {
  const data = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=50`)
  return (data.items ?? []).map((item: { track: unknown }) => item.track).filter(Boolean)
}

export function extractPlaylistId(url: string): string | null {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

