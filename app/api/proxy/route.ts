import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOSTS = ['p.scdn.co', 'audio-ssl.itunes.apple.com', 'dzcdn.net']

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  try {
    const parsed = new URL(url)
    if (!ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      return NextResponse.json({ error: 'Disallowed host' }, { status: 403 })
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 502 })
  }
}
