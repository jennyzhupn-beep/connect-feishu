// 阅读财 — Cloudflare Worker 代理
// 部署: npx wrangler deploy (需要 Cloudflare 账号)
// 免费额度: 10万请求/天

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 豆瓣搜索
    if (path === '/book-info' || path === '/movie-info') {
      const title = url.searchParams.get('title');
      if (!title) return json({ error: 'missing title' }, 400, corsHeaders);

      const host = path === '/book-info' ? 'book.douban.com' : 'movie.douban.com';
      const doubanUrl = `https://${host}/subject_search?search_text=${encodeURIComponent(title)}`;

      try {
        const resp = await fetch(doubanUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const html = await resp.text();
        const m = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
        if (!m) return json({ author: null, cover_url: null, title }, 200, corsHeaders);

        const data = JSON.parse(m[1]);
        for (const item of (data.items || [])) {
          if (item.tpl_name === 'search_subject') {
            let author = null;
            if (item.abstract) {
              const parts = item.abstract.split('/');
              author = parts[0].trim().replace(/^\[[\s\S]*?\]\s*/, '').trim() || null;
            }
            // 封面 URL 替换为通过本 Worker 代理的地址
            const proxiedCover = item.cover_url
              ? `${new URL(request.url).origin}/cover?url=${encodeURIComponent(item.cover_url)}`
              : null;
            return json({ author, title: item.title, cover_url: proxiedCover }, 200, corsHeaders);
          }
        }
        return json({ author: null, cover_url: null, title }, 200, corsHeaders);
      } catch (e) {
        return json({ error: e.message }, 502, corsHeaders);
      }
    }

    // 封面图片中转（绕过豆瓣防盗链）
    if (path === '/cover') {
      const coverUrl = url.searchParams.get('url');
      if (!coverUrl) return json({ error: 'missing url' }, 400, corsHeaders);
      try {
        const resp = await fetch(coverUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://book.douban.com/' },
        });
        return new Response(resp.body, {
          status: 200,
          headers: {
            'Content-Type': resp.headers.get('Content-Type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
            ...corsHeaders,
          },
        });
      } catch (e) {
        return json({ error: e.message }, 502, corsHeaders);
      }
    }

    return json({ usage: '/book-info?title=书名 | /movie-info?title=片名 | /cover?url=图片URL' }, 200, corsHeaders);
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
