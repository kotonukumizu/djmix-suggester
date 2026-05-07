import { NextRequest, NextResponse } from 'next/server'
import { searchTracks } from '@/lib/itunes'
import { Track } from '@/types'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')
  if (!q || q.length < 3) return NextResponse.json([], { status: 200 })

  const items = await searchTracks(q, 5)
  const tracks: Track[] = items.map((t) => ({
    spotifyId: t.id,
    name: t.name,
    artist: t.artists[0]?.name ?? '',
    albumArt: t.album.images[0]?.url ?? null,
    previewUrl: t.preview_url,
    bpm: null,
    camelot: null,
    isBridge: false,
  }))

  return NextResponse.json(tracks)
}
