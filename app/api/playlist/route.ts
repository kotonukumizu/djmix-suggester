import { NextRequest, NextResponse } from 'next/server'
import { getPlaylistTracks, extractPlaylistId } from '@/lib/spotify'
import { Track } from '@/types'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  const playlistId = extractPlaylistId(url)
  if (!playlistId) return NextResponse.json({ error: 'Invalid Spotify playlist URL' }, { status: 400 })

  const items = await getPlaylistTracks(playlistId)
  const tracks: Track[] = items.map((t: {
    id: string
    name: string
    artists: { name: string }[]
    album: { images: { url: string }[] }
    preview_url: string | null
  }) => ({
    spotifyId: t.id,
    name: t.name,
    artist: t.artists?.[0]?.name ?? '',
    albumArt: t.album?.images?.[0]?.url ?? null,
    previewUrl: t.preview_url ?? null,
    bpm: null,
    camelot: null,
    isBridge: false,
  }))

  return NextResponse.json(tracks)
}
