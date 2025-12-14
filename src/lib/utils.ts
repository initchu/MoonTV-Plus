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
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getImageProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
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

/**
 * 解析m3u8播放列表，返回ts分片URL列表
 * @param m3u8Url m3u8播放列表URL
 * @returns Promise<string[]> ts分片URL列表
 */
export async function parseM3u8(m3u8Url: string): Promise<string[]> {
  try {
    const response = await fetch(m3u8Url);
    const text = await response.text();

    // 检查是否为多级m3u8（包含清晰度选择）
    const isMasterPlaylist = text.includes('#EXT-X-STREAM-INF');

    if (isMasterPlaylist) {
      // 解析主播放列表，获取不同清晰度的m3u8 URL
      const masterLines = text.split('\n');
      const qualityPlaylists: Array<{ quality: number; url: string }> = [];

      // 获取基础URL
      const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

      // 解析主播放列表中的清晰度和对应m3u8 URL
      for (let i = 0; i < masterLines.length; i++) {
        const line = masterLines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          // 提取清晰度信息（带宽）
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          const bandwidth = bandwidthMatch
            ? parseInt(bandwidthMatch[1], 10)
            : 0;

          // 下一行是对应的m3u8 URL
          const nextLine = masterLines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith('#')) {
            // 处理相对URL
            let playlistUrl: string;
            if (nextLine.startsWith('http')) {
              playlistUrl = nextLine;
            } else if (nextLine.startsWith('/')) {
              // 绝对路径，需要拼接域名
              const urlObj = new URL(m3u8Url);
              playlistUrl = `${urlObj.protocol}//${urlObj.host}${nextLine}`;
            } else {
              // 相对路径，拼接基础URL
              playlistUrl = `${baseUrl}${nextLine}`;
            }

            qualityPlaylists.push({ quality: bandwidth, url: playlistUrl });
          }
        }
      }

      if (qualityPlaylists.length === 0) {
        throw new Error('未找到清晰度播放列表');
      }

      // 选择最高清晰度
      qualityPlaylists.sort((a, b) => b.quality - a.quality);
      const bestQualityPlaylist = qualityPlaylists[0].url;

      // 递归解析最高清晰度的m3u8文件
      return await parseM3u8(bestQualityPlaylist);
    } else {
      // 解析普通m3u8文件，提取所有ts分片URL
      const lines = text.split('\n');
      const tsUrls: string[] = [];

      // 获取基础URL（用于相对路径）
      const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

      for (const line of lines) {
        const trimmedLine = line.trim();
        // 跳过注释和空行
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          // 处理相对路径和绝对路径
          let tsUrl: string;
          if (trimmedLine.startsWith('http')) {
            tsUrl = trimmedLine;
          } else if (trimmedLine.startsWith('/')) {
            // 绝对路径，需要拼接域名
            const urlObj = new URL(m3u8Url);
            tsUrl = `${urlObj.protocol}//${urlObj.host}${trimmedLine}`;
          } else {
            // 相对路径，拼接基础URL
            tsUrl = `${baseUrl}${trimmedLine}`;
          }

          tsUrls.push(tsUrl);
        }
      }

      return tsUrls;
    }
  } catch (error) {
    throw new Error(
      `解析m3u8失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 下载单个ts分片
 * @param url ts分片URL
 * @param signal AbortController信号，用于中断下载
 * @returns Promise<ArrayBuffer> ts分片数据
 */
export async function downloadTsSegment(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载ts分片失败: ${response.status}`);
  }
  return await response.arrayBuffer();
}

/**
 * 合并多个ArrayBuffer
 * @param buffers ArrayBuffer数组
 * @returns Blob 合并后的Blob对象
 */
export function mergeArrayBuffers(buffers: ArrayBuffer[]): Blob {
  // 计算总大小
  const totalSize = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);

  // 创建新的ArrayBuffer和Uint8Array
  const result = new Uint8Array(totalSize);
  let offset = 0;

  // 复制所有buffer到result
  for (const buffer of buffers) {
    result.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }

  // 返回MP4格式的Blob（实际是ts格式，但浏览器可以播放）
  return new Blob([result], { type: 'video/mp4' });
}

/**
 * 下载并保存Blob文件
 * @param blob Blob对象
 * @param filename 文件名
 */
export function saveBlobToFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 下载单个m3u8视频
 * @param m3u8Url m3u8播放列表URL
 * @param filename 保存的文件名
 * @param onProgress 进度回调函数
 * @param signal AbortController信号，用于中断下载
 * @param maxConcurrent 最大并发下载数，默认5
 * @returns Promise<void>
 */
export async function downloadVideo(
  m3u8Url: string,
  filename: string,
  onProgress?: (progress: number, current: number, total: number) => void,
  signal?: AbortSignal,
  maxConcurrent = 5
): Promise<void> {
  try {
    // 解析m3u8，获取ts分片列表
    const tsUrls = await parseM3u8(m3u8Url);
    if (tsUrls.length === 0) {
      throw new Error('未找到ts分片');
    }

    // 下载所有ts分片（并行下载）
    const tsBuffers: ArrayBuffer[] = new Array(tsUrls.length);
    let downloadedCount = 0;

    // 并行下载函数
    const downloadInParallel = async () => {
      // 使用外部传入的signal，不创建新的controller
      if (signal && signal.aborted) {
        return;
      }

      // 任务队列
      const taskQueue: Array<[number, string]> = [];
      for (let i = 0; i < tsUrls.length; i++) {
        taskQueue.push([i, tsUrls[i]]);
      }
      const activeTasks: Promise<void>[] = [];

      // 处理单个任务
      const processTask = async () => {
        if (signal && signal.aborted) {
          return;
        }

        const task = taskQueue.shift();
        if (!task) return;

        const [index, tsUrl] = task;

        try {
          // 下载ts分片
          const buffer = await downloadTsSegment(tsUrl, signal);
          tsBuffers[index] = buffer;
          downloadedCount++;

          // 调用进度回调
          if (onProgress) {
            const progress = Math.round(
              (downloadedCount / tsUrls.length) * 100
            );
            onProgress(progress, downloadedCount, tsUrls.length);
          }

          // 继续处理下一个任务
          await processTask();
        } catch (error) {
          if (signal && signal.aborted) {
            return;
          }
          // 重试机制：失败后重新加入队列
          taskQueue.unshift([index, tsUrl]);
          await processTask();
        }
      };

      // 启动并行任务
      for (let i = 0; i < Math.min(maxConcurrent, tsUrls.length); i++) {
        activeTasks.push(processTask());
      }

      // 等待所有任务完成
      await Promise.all(activeTasks);

      // 检查是否所有分片都已下载
      const allDownloaded = tsBuffers.every((buffer) => buffer !== undefined);
      if (!allDownloaded) {
        throw new Error('部分ts分片下载失败');
      }
    };

    // 开始并行下载
    await downloadInParallel();

    // 合并ts分片
    const mergedBlob = mergeArrayBuffers(tsBuffers as ArrayBuffer[]);

    // 保存文件
    saveBlobToFile(mergedBlob, filename);
  } catch (error) {
    // 如果是用户中断，不抛出错误
    if (signal && signal.aborted) {
      return;
    }
    throw new Error(
      `下载视频失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 下载视频合集
 * @param episodes 视频集数URL列表
 * @param titles 视频集数标题列表
 * @param baseFilename 基础文件名
 * @param onProgress 进度回调函数
 * @param signal AbortController信号，用于中断下载
 * @param maxConcurrent 最大并发下载数，默认5
 * @returns Promise<void>
 */
export async function downloadPlaylist(
  episodes: string[],
  titles: string[],
  baseFilename: string,
  onProgress?: (
    currentEpisode: number,
    totalEpisodes: number,
    episodeProgress: number
  ) => void,
  signal?: AbortSignal,
  maxConcurrent = 5
): Promise<void> {
  try {
    for (let i = 0; i < episodes.length; i++) {
      // 检查是否已被中断
      if (signal && signal.aborted) {
        return;
      }

      const m3u8Url = episodes[i];
      const title = titles[i] || `第${i + 1}集`;
      const filename = `${baseFilename} - ${title}.mp4`;

      // 下载单集视频
      await downloadVideo(
        m3u8Url,
        filename,
        (progress) => {
          if (onProgress) {
            onProgress(i + 1, episodes.length, progress);
          }
        },
        signal,
        maxConcurrent
      );
    }
  } catch (error) {
    // 如果是用户中断，不抛出错误
    if (signal && signal.aborted) {
      return;
    }
    console.error('下载合集失败:', error);
    throw new Error(
      `下载合集失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
