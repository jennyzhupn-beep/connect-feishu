// 阅读财 — 豆瓣代理 + Cloudflare Tunnel（全自动）
// 用法：node author-proxy.mjs
// 自动开启 tunnel，公网地址通过 /health 返回

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const DATA_FILE = 'E:/claude code/connect feishu/reading-data.json';

const PORT = 3456;
let tunnelUrl = null;

// ===== 启动 Cloudflare Tunnel =====
const cf = spawn('E:/cloudflared.exe', ['tunnel', '--url', 'http://localhost:' + PORT], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

cf.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  const m = text.match(/https:\/\/[\w-]+\.trycloudflare\.com/);
  if (m) {
    tunnelUrl = m[0];
    console.log('🌐 公网地址: ' + tunnelUrl);
  }
});

cf.stderr.on('data', (chunk) => {
  if (chunk.toString().includes('trycloudflare.com')) {
    const m = chunk.toString().match(/https:\/\/[\w-]+\.trycloudflare\.com/);
    if (m) { tunnelUrl = m[0]; console.log('🌐 公网地址: ' + tunnelUrl); }
  }
});

cf.on('exit', (code) => { console.log('⚠️ Tunnel 退出, 码: ' + code); });

// ===== 豆瓣搜索 =====
function fetchDouban(path, host) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: host, path: path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Cookie': 'bid=' + Math.random().toString(36).substr(2, 10),
      },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const u = new URL(res.headers.location);
        fetchDouban(u.pathname + u.search, u.hostname).then(resolve).catch(reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractInfo(html) {
  const m = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return null;
  const data = JSON.parse(m[1]);
  for (const item of (data.items || [])) {
    if (item.tpl_name === 'search_subject') {
      let author = null;
      if (item.abstract) {
        const parts = item.abstract.split('/');
        author = parts[0].trim().replace(/^\[[\s\S]*?\]\s*/, '').trim() || null;
      }
      return { author, title: item.title, cover_url: item.cover_url || null };
    }
  }
  return null;
}

// ===== HTTP 服务器 =====
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // 健康检查（返回 tunnel 地址）
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', tunnel_url: tunnelUrl }));
    return;
  }

  // 书籍搜索
  if (path === '/book-info' || path === '/movie-info') {
    const title = url.searchParams.get('title');
    if (!title) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing title' })); return; }

    const host = path === '/book-info' ? 'book.douban.com' : 'movie.douban.com';
    try {
      const html = await fetchDouban('/subject_search?search_text=' + encodeURIComponent(title), host);
      const result = extractInfo(html);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result || { author: null, cover_url: null, title }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 兼容旧接口
  if (path === '/author' && url.searchParams.has('title')) {
    const title = url.searchParams.get('title').trim();
    try {
      const html = await fetchDouban('/subject_search?search_text=' + encodeURIComponent(title), 'book.douban.com');
      const result = extractInfo(html);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ author: result?.author || null, title: result?.title || title }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 封面图片中转
  if (path === '/cover') {
    const coverUrl = url.searchParams.get('url');
    if (!coverUrl) { res.writeHead(400); res.end('missing url'); return; }
    try {
      const u = new URL(coverUrl);
      const coverReq = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://book.douban.com/' },
        timeout: 8000,
      }, (coverRes) => {
        res.writeHead(200, {
          'Content-Type': coverRes.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        });
        coverRes.pipe(res);
      });
      coverReq.on('error', () => { res.writeHead(502); res.end(); });
      coverReq.on('timeout', () => { coverReq.destroy(); res.writeHead(504); res.end(); });
    } catch(e) { res.writeHead(400); res.end('invalid url'); }
    return;
  }

  // ===== 数据同步 =====
  if (path === '/data') {
    // GET: 返回云端数据
    if (req.method === 'GET') {
      try {
        if (fs.existsSync(DATA_FILE)) {
          const raw = fs.readFileSync(DATA_FILE, 'utf-8');
          const d = JSON.parse(raw);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ updated: d.updated || 0, items: d.items || [] }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ updated: 0, items: [] }));
        }
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // POST: 提交数据（批量覆盖）
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body);
          // 合并策略：以新数据为准，简单覆盖
          const saved = { updated: Date.now(), items: incoming.items || [] };
          fs.writeFileSync(DATA_FILE, JSON.stringify(saved, null, 2), 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, updated: saved.updated }));
        } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('📚 代理已启动 → http://localhost:' + PORT);
  console.log('🌐 等待 Cloudflare Tunnel 连接...');
});
