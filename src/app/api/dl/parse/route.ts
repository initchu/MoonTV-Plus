import { NextResponse } from 'next/server';

export const runtime = 'edge';

interface SegmentInfo {
  url: string;
  index: number;
}

interface QualityVariant {
  bandwidth: number;
  resolution?: string;
  url: string;
}

interface ParseResult {
  type: 'master' | 'playlist';
  segments: SegmentInfo[];
  totalSegments: number;
  encrypted: boolean;
  encryptionMethod: string | null;
  qualities?: QualityVariant[];
  selectedQuality?: QualityVariant;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: new URL(url).origin,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch m3u8: ${response.status}`);
  }

  return await response.text();
}

function resolveUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const baseUrl = base.substring(0, base.lastIndexOf('/') + 1);
  if (path.startsWith('/')) {
    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}${path}`;
  }
  return `${baseUrl}${path}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const m3u8Url = searchParams.get('url');

  if (!m3u8Url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const content = await fetchText(m3u8Url);
    const lines = content.split('\n').map((l) => l.trim());

    // Check if master playlist (has #EXT-X-STREAM-INF)
    const isMaster = content.includes('#EXT-X-STREAM-INF');

    // Detect encryption
    const encryptionMatch = content.match(/#EXT-X-KEY:METHOD=([\w-]+)/);
    const encrypted = !!encryptionMatch;
    const encryptionMethod = encryptionMatch ? encryptionMatch[1] : null;

    if (isMaster) {
      // Parse quality variants
      const qualities: QualityVariant[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
          const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
          const resolutionMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
          const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

          const nextLine = lines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith('#')) {
            qualities.push({
              bandwidth,
              resolution: resolutionMatch ? resolutionMatch[1] : undefined,
              url: resolveUrl(m3u8Url, nextLine),
            });
          }
        }
      }

      // Select highest quality
      qualities.sort((a, b) => b.bandwidth - a.bandwidth);
      const best = qualities[0];

      if (!best) {
        return NextResponse.json({ error: 'No quality variants found' }, { status: 400 });
      }

      // Recursively parse the selected quality playlist
      const subContent = await fetchText(best.url);
      const subLines = subContent.split('\n').map((l) => l.trim());

      const segments: SegmentInfo[] = [];
      for (let i = 0; i < subLines.length; i++) {
        if (subLines[i] && !subLines[i].startsWith('#') && subLines[i].includes('.ts')) {
          segments.push({
            url: resolveUrl(best.url, subLines[i]),
            index: segments.length,
          });
        }
      }

      const result: ParseResult = {
        type: 'playlist',
        segments,
        totalSegments: segments.length,
        encrypted: subContent.includes('#EXT-X-KEY:METHOD='),
        encryptionMethod: subContent.match(/#EXT-X-KEY:METHOD=([\w-]+)/)?.[1] || null,
        qualities,
        selectedQuality: best,
      };

      return NextResponse.json(result);
    }

    // Parse regular playlist
    const segments: SegmentInfo[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && !lines[i].startsWith('#') && lines[i].includes('.ts')) {
        segments.push({
          url: resolveUrl(m3u8Url, lines[i]),
          index: segments.length,
        });
      }
    }

    const result: ParseResult = {
      type: 'playlist',
      segments,
      totalSegments: segments.length,
      encrypted,
      encryptionMethod,
    };

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Parse failed: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 }
    );
  }
}
