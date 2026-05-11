/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import Hls from 'hls.js';

/**
 * 获取图片代理 URL 设置
 */
export function getImageProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启图片代理，则不使用代理
  const enableImageProxy = localStorage.getItem('enableImageProxy');
  if (enableImageProxy !== null) {
    if (!JSON.parse(enableImageProxy) as boolean) {
      return null;
    }
  }

  const localImageProxy = localStorage.getItem('imageProxyUrl');
  if (localImageProxy != null) {
    return localImageProxy.trim() ? localImageProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY;
  return serverImageProxy && serverImageProxy.trim()
    ? serverImageProxy.trim()
    : null;
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理；
 * 否则对所有外部图片自动走本地 /api/image-proxy，避免防盗链和跨域问题。
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 本地路径不需要代理
  if (
    !originalUrl.startsWith('http://') &&
    !originalUrl.startsWith('https://')
  ) {
    return originalUrl;
  }

  const proxyUrl = getImageProxyUrl();
  if (proxyUrl) {
    return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
  }

  // 所有外部图片走本地代理，解决防盗链和跨域问题
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * 获取豆瓣代理 URL 设置
 */
export function getDoubanProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启豆瓣代理，则不使用代理
  const enableDoubanProxy = localStorage.getItem('enableDoubanProxy');
  if (enableDoubanProxy !== null) {
    if (!JSON.parse(enableDoubanProxy) as boolean) {
      return null;
    }
  }

  const localDoubanProxy = localStorage.getItem('doubanProxyUrl');
  if (localDoubanProxy != null) {
    return localDoubanProxy.trim() ? localDoubanProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverDoubanProxy = (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY;
  return serverDoubanProxy && serverDoubanProxy.trim()
    ? serverDoubanProxy.trim()
    : null;
}

/**
 * 处理豆瓣 URL，如果设置了豆瓣代理则使用代理
 */
export function processDoubanUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getDoubanProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .replace(/&nbsp;/g, ' ') // 将 &nbsp; 替换为空格
    .trim(); // 去掉首尾空格
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(m3u8Url: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
}> {
  try {
    // 直接使用m3u8 URL作为视频源，避免CORS问题
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      // 测量网络延迟（ping时间） - 使用m3u8 URL而不是ts文件
      const pingStart = performance.now();
      let pingTime = 0;

      // 测量ping时间（使用m3u8 URL）
      fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 记录到失败为止的时间
        });

      // 固定使用hls.js加载
      const hls = new Hls();

      // 设置超时处理
      const timeout = setTimeout(() => {
        hls.destroy();
        video.remove();
        reject(new Error('Timeout loading video metadata'));
      }, 4000);

      video.onerror = () => {
        clearTimeout(timeout);
        hls.destroy();
        video.remove();
        reject(new Error('Failed to load video metadata'));
      };

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;

      let fragmentStartTime = 0;

      // 检查是否可以返回结果
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          clearTimeout(timeout);
          const width = video.videoWidth;
          if (width && width > 0) {
            hls.destroy();
            video.remove();

            // 根据视频宽度判断视频质量等级，使用经典分辨率的宽度作为分割点
            const quality =
              width >= 3840
                ? '4K' // 4K: 3840x2160
                : width >= 2560
                ? '2K' // 2K: 2560x1440
                : width >= 1920
                ? '1080p' // 1080p: 1920x1080
                : width >= 1280
                ? '720p' // 720p: 1280x720
                : width >= 854
                ? '480p'
                : 'SD'; // 480p: 854x480

            resolve({
              quality,
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          } else {
            // webkit 无法获取尺寸，直接返回
            resolve({
              quality: '未知',
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          }
        }
      };

      // 监听片段加载开始
      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartTime = performance.now();
      });

      // 监听片段加载完成，只需首个分片即可计算速度
      hls.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
        if (
          fragmentStartTime > 0 &&
          data &&
          data.payload &&
          !hasSpeedCalculated
        ) {
          const loadTime = performance.now() - fragmentStartTime;
          const size = data.payload.byteLength || 0;

          if (loadTime > 0 && size > 0) {
            const speedKBps = size / 1024 / (loadTime / 1000);

            // 立即计算速度，无需等待更多分片
            const avgSpeedKBps = speedKBps;

            if (avgSpeedKBps >= 1024) {
              actualLoadSpeed = `${(avgSpeedKBps / 1024).toFixed(1)} MB/s`;
            } else {
              actualLoadSpeed = `${avgSpeedKBps.toFixed(1)} KB/s`;
            }
            hasSpeedCalculated = true;
            checkAndResolve(); // 尝试返回结果
          }
        }
      });

      hls.loadSource(m3u8Url);
      hls.attachMedia(video);

      // 监听hls.js错误
      hls.on(Hls.Events.ERROR, (event: any, data: any) => {
        console.error('HLS错误:', data);
        if (data.fatal) {
          clearTimeout(timeout);
          hls.destroy();
          video.remove();
          reject(new Error(`HLS播放失败: ${data.type}`));
        }
      });

      // 监听视频元数据加载完成
      video.onloadedmetadata = () => {
        hasMetadataLoaded = true;
        checkAndResolve(); // 尝试返回结果
      };
    });
  } catch (error) {
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// ============================================================================
// 下载相关工具函数
// ============================================================================

/**
 * 解析 m3u8 播放列表，返回 TS 分片 URL 列表。
 * 支持 Master Playlist（多码率）和普通 Playlist，支持相对/绝对路径。
 * 直连请求，与播放器行为一致（资源站 TS 分片本身带 CORS 头）。
 */
export async function parseM3u8(m3u8Url: string): Promise<string[]> {
  const response = await fetch(m3u8Url);
  if (!response.ok) {
    throw new Error(`获取 m3u8 失败: ${response.status}`);
  }
  const text = await response.text();

  const resolveUrl = (base: string, path: string): string => {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/')) {
      const u = new URL(base);
      return `${u.protocol}//${u.host}${path}`;
    }
    return base.substring(0, base.lastIndexOf('/') + 1) + path;
  };

  // Master Playlist：选最高码率的子列表递归解析
  if (text.includes('#EXT-X-STREAM-INF')) {
    const lines = text.split('\n');
    const variants: Array<{ bandwidth: number; url: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const next = lines[i + 1]?.trim();
        if (next && !next.startsWith('#')) {
          variants.push({ bandwidth, url: resolveUrl(m3u8Url, next) });
        }
      }
    }
    if (variants.length === 0) throw new Error('未找到子播放列表');
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return parseM3u8(variants[0].url);
  }

  // 普通 Playlist：提取所有媒体分片行（非注释、非空行）
  const lines = text.split('\n');
  const segmentUrls: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      segmentUrls.push(resolveUrl(m3u8Url, trimmed));
    }
  }
  if (segmentUrls.length === 0) throw new Error('m3u8 中未找到媒体分片');
  return segmentUrls;
}

/**
 * 直连下载单个 TS 分片，返回 ArrayBuffer。
 * 资源站 TS 分片本身带 CORS 头，与播放器直连行为一致，无需代理。
 */
async function fetchSegment(
  segmentUrl: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const response = await fetch(segmentUrl, { signal });
  if (!response.ok) throw new Error(`分片下载失败: ${response.status}`);
  return response.arrayBuffer();
}

// ─── 并发下载引擎 ─────────────────────────────────────────────────────────────
//
// 设计：下载与写入完全解耦
//   - 自适应并发：初始 3，连续成功后逐步提升（最大 6），失败后立即降低
//   - 独立的 writer loop 按顺序消费 buffers[]，通过 Promise 信号唤醒，不轮询
//   - 取消时 AbortSignal 直接中断所有 fetch，响应即时
//   - Failed to fetch（限流/CORS）时降并发 + 指数退避重试
//
const INITIAL_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const MIN_CONCURRENCY = 1;

export interface DownloadProgress {
  percent: number;       // 0-100
  downloaded: number;    // 已下载分片数
  total: number;         // 总分片数
  speedMBps: number;     // 当前速度 MB/s（近 1 秒滑动窗口）
  concurrency: number;   // 当前活跃并发数
}

/**
 * 核心并发下载引擎。
 *
 * @param segmentUrls  分片 URL 列表
 * @param onSegment    按顺序回调每个分片的数据（写入方负责实现）
 * @param onProgress   进度回调（含实时速度和并发数）
 * @param signal       取消信号
 */
async function runSegmentDownloads(
  segmentUrls: string[],
  onSegment: (buf: ArrayBuffer) => Promise<void>,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const total = segmentUrls.length;
  const buffers: (ArrayBuffer | null | 'done')[] = new Array(total).fill(null);
  let downloadedCount = 0;
  let nextWriteIdx = 0;
  let activeWorkers = 0;
  let targetConcurrency = INITIAL_CONCURRENCY;
  let consecutiveSuccess = 0;

  // ── 速度计算：滑动窗口（最近 1 秒内下载的字节数）
  const speedWindow: { ts: number; bytes: number }[] = [];
  const recordBytes = (bytes: number) => {
    const now = performance.now();
    speedWindow.push({ ts: now, bytes });
    while (speedWindow.length > 0 && now - speedWindow[0].ts > 1000) speedWindow.shift();
  };
  const getSpeedMBps = (): number => {
    if (speedWindow.length === 0) return 0;
    const totalBytes = speedWindow.reduce((s, x) => s + x.bytes, 0);
    const span = Math.max(performance.now() - speedWindow[0].ts, 100);
    return totalBytes / (span / 1000) / (1024 * 1024);
  };

  // writer loop 通过这个 resolve 被唤醒
  let writerWakeup: (() => void) | null = null;
  const notifyWriter = () => { writerWakeup?.(); };

  // ── writer loop ────────────────────────────────────────────────────────────
  const writerDone = (async () => {
    while (nextWriteIdx < total) {
      if (signal?.aborted) return;
      const buf = buffers[nextWriteIdx];
      if (buf === null || buf === 'done') {
        await new Promise<void>((resolve) => { writerWakeup = resolve; });
        continue;
      }
      buffers[nextWriteIdx] = 'done';
      await onSegment(buf as ArrayBuffer);
      nextWriteIdx++;
    }
  })();

  // ── fetch workers ──────────────────────────────────────────────────────────
  let queuePos = 0;
  let spawnMore: (() => void) | null = null;

  const worker = async () => {
    activeWorkers++;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted) return;
        const pos = queuePos++;
        if (pos >= total) return;

        let delay = 800;
        let succeeded = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (signal?.aborted) return;
          try {
            const buf = await fetchSegment(segmentUrls[pos], signal);
            recordBytes(buf.byteLength);
            buffers[pos] = buf;
            downloadedCount++;
            consecutiveSuccess++;
            // 连续成功 8 次，尝试提升并发
            if (consecutiveSuccess >= 8 && targetConcurrency < MAX_CONCURRENCY) {
              targetConcurrency = Math.min(targetConcurrency + 1, MAX_CONCURRENCY);
              consecutiveSuccess = 0;
              spawnMore?.();
            }
            onProgress?.({
              percent: Math.round((downloadedCount / total) * 100),
              downloaded: downloadedCount,
              total,
              speedMBps: getSpeedMBps(),
              concurrency: activeWorkers,
            });
            if (pos === nextWriteIdx) notifyWriter();
            succeeded = true;
            break;
          } catch (err) {
            if (signal?.aborted) return;
            consecutiveSuccess = 0;
            if (attempt < 3) {
              // 失败时降低并发，给资源站减压
              targetConcurrency = Math.max(targetConcurrency - 1, MIN_CONCURRENCY);
              await new Promise((r) => setTimeout(r, delay));
              delay = Math.min(delay * 2, 5000);
            } else {
              throw new Error(`分片 ${pos} 下载失败: ${err}`);
            }
          }
        }
        if (!succeeded) return; // 不应到达，保险起见
      }
    } finally {
      activeWorkers--;
      spawnMore?.();
    }
  };

  // ── 调度器：维持 activeWorkers === targetConcurrency ──────────────────────
  const runScheduler = async () => {
    while (!signal?.aborted) {
      // 补充 worker 直到达到目标并发数
      while (activeWorkers < targetConcurrency && queuePos < total && !signal?.aborted) {
        worker().catch((_e) => { /* 错误由 Promise.all 捕获 */ });
      }
      // 所有分片已分配完，退出调度
      if (queuePos >= total) break;
      await new Promise<void>((resolve) => { spawnMore = resolve; });
    }
  };

  // 启动初始 worker
  const initialCount = Math.min(INITIAL_CONCURRENCY, total);
  const initialWorkers: Promise<void>[] = [];
  for (let i = 0; i < initialCount; i++) {
    initialWorkers.push(worker());
  }

  runScheduler(); // 后台运行，不 await

  // 等待所有 worker（含调度器后续补充的）完成
  await Promise.all(initialWorkers);
  while (activeWorkers > 0) {
    await new Promise<void>((resolve) => {
      spawnMore = resolve;
      setTimeout(resolve, 100); // 兜底：最多等 100ms
    });
  }

  notifyWriter();
  await writerDone;
}

// ─── File System Access API 检测 ─────────────────────────────────────────────
function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * 流式写入单集（File System Access API）。
 * 分片下载完立即写入磁盘，内存中只保留并发中的少量分片。
 */
async function downloadVideoStreaming(
  segmentUrls: string[],
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const fileHandle = await (window as any).showSaveFilePicker({
    suggestedName: filename,
    types: [{ description: 'Video file', accept: { 'video/mp4': ['.mp4'] } }],
  });
  const writable = await fileHandle.createWritable();
  let failed = false;

  try {
    await runSegmentDownloads(
      segmentUrls,
      (buf) => writable.write(buf),
      onProgress,
      signal
    );
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    await writable.close();
    if (failed || signal?.aborted) {
      try { await (fileHandle as any).remove(); } catch { /* 实验性 API，不支持时忽略 */ }
    }
  }
}

/**
 * 内存合并下载（降级方案）。
 * 全部分片下载完后合并为 Blob 触发浏览器保存对话框。
 */
async function downloadVideoInMemory(
  segmentUrls: string[],
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const total = segmentUrls.length;
  const buffers: ArrayBuffer[] = new Array(total);
  let idx = 0;

  await runSegmentDownloads(
    segmentUrls,
    async (buf) => { buffers[idx++] = buf; },
    onProgress,
    signal
  );

  if (signal?.aborted) return;

  const blob = new Blob(buffers, { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * 多集流式写入到同一目录（File System Access API）。
 * 只弹一次目录选择对话框，每集写入独立文件。
 */
async function downloadPlaylistStreaming(
  episodes: string[],
  filenames: string[],
  onProgress?: (cur: number, total: number, p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });

  for (let i = 0; i < episodes.length; i++) {
    if (signal?.aborted) return;

    const segmentUrls = await parseM3u8(episodes[i]);
    if (segmentUrls.length === 0) throw new Error(`第 ${i + 1} 集未找到媒体分片`);

    const fileHandle = await dirHandle.getFileHandle(filenames[i], { create: true });
    const writable = await fileHandle.createWritable();
    let failed = false;

    try {
      await runSegmentDownloads(
        segmentUrls,
        (buf) => writable.write(buf),
        (p) => onProgress?.(i + 1, episodes.length, p),
        signal
      );
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      await writable.close();
      if (failed || signal?.aborted) {
        try { await (fileHandle as any).remove(); } catch { /* ignore */ }
      }
    }

    if (signal?.aborted) return;
  }
}

/**
 * 下载单个 m3u8 视频并保存为文件。
 *
 * 优先使用 File System Access API（流式写入，内存占用低，速度快）；
 * 不支持时降级为内存合并方案。
 *
 * @param m3u8Url     m3u8 播放列表地址
 * @param filename    保存的文件名（含扩展名）
 * @param onProgress  进度回调 (percent 0-100, downloaded, total)
 * @param signal      AbortSignal，用于取消下载
 */
export async function downloadVideo(
  m3u8Url: string,
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;

  const segmentUrls = await parseM3u8(m3u8Url);
  if (segmentUrls.length === 0) throw new Error('未找到媒体分片');

  if (supportsFileSystemAccess()) {
    await downloadVideoStreaming(segmentUrls, filename, onProgress, signal);
  } else {
    await downloadVideoInMemory(segmentUrls, filename, onProgress, signal);
  }
}

export async function downloadPlaylist(
  episodes: string[],
  titles: string[],
  baseFilename: string,
  onProgress?: (
    currentEpisode: number,
    totalEpisodes: number,
    p: DownloadProgress
  ) => void,
  signal?: AbortSignal
): Promise<void> {
  const filenames = titles.map(
    (title, i) => `${baseFilename} - ${title || `第${i + 1}集`}.mp4`
  );

  if (supportsDirectoryPicker()) {
    await downloadPlaylistStreaming(episodes, filenames, onProgress, signal);
  } else {
    for (let i = 0; i < episodes.length; i++) {
      if (signal?.aborted) return;
      const segmentUrls = await parseM3u8(episodes[i]);
      if (segmentUrls.length === 0) throw new Error(`第 ${i + 1} 集未找到媒体分片`);
      await downloadVideoInMemory(
        segmentUrls,
        filenames[i],
        (p) => onProgress?.(i + 1, episodes.length, p),
        signal
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 站点测速缓存（localStorage）
// ─────────────────────────────────────────────────────────────────────────────

const SPEEDTEST_CACHE_KEY = 'site_speedtest_cache';
const SPEEDTEST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟

export interface SiteSpeedResult {
  key: string;
  name: string;
  latency: number | null; // null = 超时/失败
}

interface SpeedtestCache {
  results: SiteSpeedResult[];
  testedAt: number;
}

/**
 * 读取本地缓存的测速结果。
 * 若缓存不存在或已过期（超过 TTL），返回 null。
 */
export function getCachedSpeedtest(): SiteSpeedResult[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SPEEDTEST_CACHE_KEY);
    if (!raw) return null;
    const cache: SpeedtestCache = JSON.parse(raw);
    if (Date.now() - cache.testedAt > SPEEDTEST_CACHE_TTL_MS) return null;
    return cache.results;
  } catch {
    return null;
  }
}

/**
 * 将测速结果写入 localStorage 缓存。
 */
export function setCachedSpeedtest(results: SiteSpeedResult[]): void {
  if (typeof window === 'undefined') return;
  try {
    const cache: SpeedtestCache = { results, testedAt: Date.now() };
    localStorage.setItem(SPEEDTEST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

/**
 * 触发一次后台测速，结果写入缓存。
 * 若已有未过期缓存，则跳过（除非 force=true）。
 * 返回测速结果（或已有缓存）。
 */
export async function runSpeedtestInBackground(
  force = false
): Promise<SiteSpeedResult[]> {
  if (!force) {
    const cached = getCachedSpeedtest();
    if (cached) return cached;
  }
  try {
    const res = await fetch('/api/speedtest');
    if (!res.ok) return [];
    const data = await res.json();
    const results: SiteSpeedResult[] = data.results || [];
    setCachedSpeedtest(results);
    return results;
  } catch {
    return [];
  }
}

/**
 * 根据测速缓存对 SearchResult 列表排序：
 * 延迟低的站点排在前面，未测速的站点保持原顺序放在后面。
 */
export function sortSourcesBySpeedCache<
  T extends { source: string },
>(sources: T[], speedResults: SiteSpeedResult[]): T[] {
  if (!speedResults || speedResults.length === 0) return sources;

  // 构建 key → rank 映射（rank 越小越快）
  const rankMap = new Map<string, number>();
  speedResults.forEach((r, idx) => {
    rankMap.set(r.key, r.latency === null ? 9999 : idx);
  });

  return [...sources].sort((a, b) => {
    const ra = rankMap.get(a.source) ?? 9999;
    const rb = rankMap.get(b.source) ?? 9999;
    return ra - rb;
  });
}
