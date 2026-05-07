import { NextRequest, NextResponse } from 'next/server'
import { buildSuggestedPlaylist } from '@/lib/algorithm'
import { Track } from '@/types'

// Gemini rate limiter (4.5s/call × max bridges) can push total time > 25s
// Raise the limit so Next.js doesn't kill the route mid-flight
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const body = await req.json()
  const tracks: Track[] = body.tracks
  const bpmTolerance: number = typeof body.bpmTolerance === 'number' ? body.bpmTolerance : 7
  const maxSuggestions: number = typeof body.maxSuggestions === 'number' ? body.maxSuggestions : 10

  if (!tracks || tracks.length === 0) {
    return NextResponse.json({ error: 'tracks is required' }, { status: 400 })
  }

  try {
    const result = await buildSuggestedPlaylist(tracks, bpmTolerance, maxSuggestions)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[suggest] buildSuggestedPlaylist error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
