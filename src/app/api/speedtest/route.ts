/* eslint-disable no-console */
/**
 * 服务端站点测速 API
 * 在服务端对各站点 API 做 HEAD 请求测延迟，绕过浏览器 CORS 限制。
 * 返回各站点的延迟排名，供前端缓存使用。
 */

import { NextResponse } from 'next/server';

import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';

const PING_TIMEOUT_MS = 5000;
const PING_REPEAT = 2; // 每个站点测几次取最小值

async function pingOnce(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const start = Date.now();
  try {
    await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    return Date.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pingSite(url: string): Promise<number | null> {
  // 并发发起多次 ping，取最小值
  const results = await Promise.all(
    Array.from({ length: PING_REPEAT }, () => pingOnce(url))
  );
  const valid = results.filter((ms): ms is number => ms !== null);
  if (valid.length === 0) return null;
  return Math.min(...valid);
}

export async function GET() {
  try {
    const sites = await getAvailableApiSites();

    // 并发测速所有站点
    const results = await Promise.all(
      sites.map(async (site) => {
        const ms = await pingSite(site.api);
        return {
          key: site.key,
          name: site.name,
          latency: ms, // null 表示超时/失败
        };
      })
    );

    // 按延迟升序排列，失败的放最后
    const sorted = results.sort((a, b) => {
      if (a.latency === null && b.latency === null) return 0;
      if (a.latency === null) return 1;
      if (b.latency === null) return -1;
      return a.latency - b.latency;
    });

    console.log(
      '[speedtest] results:',
      sorted.map((s) => `${s.name}=${s.latency ?? 'timeout'}ms`).join(', ')
    );

    return NextResponse.json(
      {
        results: sorted,
        testedAt: Date.now(),
      },
      {
        // 不缓存，每次都重新测
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (err) {
    console.error('[speedtest] error:', err);
    return NextResponse.json({ error: '测速失败' }, { status: 500 });
  }
}
