#!/usr/bin/env node
/**
 * 视频源测速脚本
 * 用法: node scripts/speedtest.js
 *
 * 自动读取 config.json 中的所有视频源，对每个源发起 3 次请求，
 * 统计最低延迟、平均延迟，并按延迟排序输出结果。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── 配置 ──────────────────────────────────────────────────────────────────────
const REPEAT = 3; // 每个源测试次数
const TIMEOUT_MS = 6000; // 单次超时（毫秒）
// ─────────────────────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const sites = Object.entries(config.api_site).map(([key, val]) => ({
  key,
  name: val.name,
  url: val.api,
}));

/** 发起一次 HTTP/HTTPS GET 请求，返回首字节时间（ms），超时或失败返回 null */
function ping(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      },
      (res) => {
        const elapsed = Date.now() - start;
        res.destroy(); // 不需要读取响应体
        resolve({ ms: elapsed, status: res.statusCode });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function avg(arr) {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function bar(ms, max) {
  if (ms === null) return '░'.repeat(20);
  const len = Math.round((ms / max) * 20);
  return '█'.repeat(len) + '░'.repeat(20 - len);
}

function colorMs(ms) {
  if (ms === null) return '\x1b[90m超时/失败\x1b[0m';
  if (ms < 300) return `\x1b[32m${ms}ms\x1b[0m`; // 绿
  if (ms < 600) return `\x1b[33m${ms}ms\x1b[0m`; // 黄
  return `\x1b[31m${ms}ms\x1b[0m`; // 红
}

async function main() {
  console.log(
    `\n\x1b[1m视频源测速\x1b[0m  (每源测 ${REPEAT} 次，超时 ${
      TIMEOUT_MS / 1000
    }s)\n`
  );
  console.log(`共 ${sites.length} 个源，开始测速...\n`);

  const results = [];

  for (const site of sites) {
    process.stdout.write(`  测试中  ${site.name.padEnd(12)} `);
    const times = [];
    let lastStatus = null;

    for (let i = 0; i < REPEAT; i++) {
      const r = await ping(site.url);
      if (r !== null) {
        times.push(r.ms);
        lastStatus = r.status;
      }
      process.stdout.write(r ? '.' : 'x');
    }

    const minMs = times.length > 0 ? Math.min(...times) : null;
    const avgMs = times.length > 0 ? avg(times) : null;
    results.push({
      ...site,
      minMs,
      avgMs,
      status: lastStatus,
      successCount: times.length,
    });

    const label =
      minMs !== null ? `  最低 ${minMs}ms  均值 ${avgMs}ms` : '  失败';
    console.log(label);
  }

  // ── 排序：可用的按最低延迟升序，失败的放最后 ──────────────────────────────
  results.sort((a, b) => {
    if (a.minMs === null && b.minMs === null) return 0;
    if (a.minMs === null) return 1;
    if (b.minMs === null) return -1;
    return a.minMs - b.minMs;
  });

  const maxMs = Math.max(
    ...results.filter((r) => r.minMs !== null).map((r) => r.minMs),
    1
  );

  console.log('\n' + '─'.repeat(72));
  console.log(
    '\x1b[1m' +
      '排名  名称            状态   最低延迟   均值延迟   成功率   延迟图' +
      '\x1b[0m'
  );
  console.log('─'.repeat(72));

  let rank = 1;
  for (const r of results) {
    const rankStr = r.minMs !== null ? String(rank++).padStart(2) : ' -';
    const nameStr = r.name.padEnd(12);
    const statusStr = r.minMs !== null ? String(r.status).padEnd(6) : '------';
    const minStr = colorMs(r.minMs).padEnd(r.minMs !== null ? 14 : 20);
    const avgStr = r.avgMs !== null ? colorMs(r.avgMs) : '';
    const rateStr = `${r.successCount}/${REPEAT}`.padEnd(5);
    const barStr = r.minMs !== null ? bar(r.minMs, maxMs) : '░'.repeat(20);

    console.log(
      `  ${rankStr}  ${nameStr}  ${statusStr}  ${minStr}  ${avgStr.padEnd(
        r.avgMs !== null ? 14 : 0
      )}  ${rateStr}  ${barStr}`
    );
  }

  console.log('─'.repeat(72));

  const ok = results.filter((r) => r.minMs !== null);
  const fail = results.filter((r) => r.minMs === null);
  console.log(
    `\n可用: \x1b[32m${ok.length}\x1b[0m  失败: \x1b[31m${fail.length}\x1b[0m  总计: ${results.length}`
  );
  if (fail.length > 0) {
    console.log(`失败源: ${fail.map((r) => r.name).join('、')}`);
  }
  console.log();
}

main().catch((e) => {
  console.error('测速出错:', e.message);
  process.exit(1);
});
