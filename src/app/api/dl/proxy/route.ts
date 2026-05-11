import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: new URL(url).origin,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream responded with ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    if (!response.body) {
      return NextResponse.json({ error: 'Empty response body' }, { status: 500 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Proxy fetch failed: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 502 }
    );
  }
}
