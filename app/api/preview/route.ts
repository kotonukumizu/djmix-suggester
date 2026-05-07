import { NextRequest, NextResponse } from 'next/server'
import { getDeezerPreview } from '@/lib/deezer'

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get('artist') ?? ''
  const title = req.nextUrl.searchParams.get('title') ?? ''
  if (!artist || !title) return NextResponse.json({ preview: null })
  const preview = await getDeezerPreview(artist, title)
  return NextResponse.json({ preview })
}
