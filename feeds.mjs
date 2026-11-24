const feeds = [
  { source: 'Washington Free Beacon', url: 'https://freebeacon.com/feed/' },
  { source: 'The Free Press', url: 'https://www.thefp.com/feed' },
  { source: 'Republican Patriot', url: 'https://republicanpatriot.com/feed/' },
  { source: 'WorldPress.com', url: 'https://worldpress.com/', links: (url) => url.hostname === 'article.wn.com' && /^\/view\/\d{4}\/\d{2}\/\d{2}\//.test(url.pathname) },
  { source: 'Israel Truth Network', url: 'https://theisraeltruthnetwork.org/feed/', home: 'https://theisraeltruthnetwork.org/todays-daily-truth/' },
  { source: 'Israel Video Network', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCKlpgUx48sCFIPcxM8AAZUA' },
  { source: 'Ynet Global', url: 'https://www.ynetnews.com/Integration/StoryRss2.xml' },
  { source: 'Jewish Insider · Daily Kickoff', url: 'https://jewishinsider.com/topics/daily-kickoff/feed/' },
  { source: 'The Daily Signal', url: 'https://www.dailysignal.com/feed/' },
  { source: 'Gatestone Institute', url: 'https://www.gatestoneinstitute.org/rss.xml' },
  { source: 'PragerU', url: 'https://www.prageru.com/browse', links: (url) => url.hostname === 'www.prageru.com' && url.pathname.startsWith('/videos/') },
  { source: 'StopAntisemitism', url: 'https://stopantisemitism.org/', links: (url, markup) => url.protocol === 'https:' && !url.hostname.endsWith('stopantisemitism.org') && /<h3\b/i.test(markup) },
  { source: 'Melanie Phillips', url: 'https://melaniephillips.substack.com/feed' },
];
const decode = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi, (entity, code, name) => {
    if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
    const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  }).trim();

function plainText(markup) {
  return decode(markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/&(?:nbsp|#160);/gi, ' ').replace(/\s+/g, ' ').trim();
}

function excerpt(markup) {
  const words = plainText(markup).split(/\s+/);
  return words.slice(0, 85).join(' ') + (words.length > 85 ? '…' : '');
}

export function parseFeed(xml, source) {
  return Array.from(xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi), ([, , item]) => {
    const value = (tag) => decode(item.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1] ?? '');
    const topics = Array.from(item.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi), ([, topic]) => decode(topic));
    const link = value('link') || decode(item.match(/<link\b[^>]*\bhref=["']([^"']+)/i)?.[1] ?? '');
    const options = ['description', 'summary', 'media:description', 'content:encoded'].map((tag) => excerpt(value(tag)));
    const summary = options.find((option) => option.split(/\s+/).length >= 42) ??
      options.reduce((longest, option) => option.length > longest.length ? option : longest, '');
    return { title: value('title'), url: link, date: value('pubDate') || value('published') || value('updated'), source, topics, summary };
  }).filter(({ title, url }) => title && /^https?:\/\//i.test(url)).slice(0, 30);
}

function parsePage(html, { url, source, links }) {
  const articles = new Map();
  for (const [, href, markup] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let target;
    try { target = new URL(decode(href), url); } catch { continue; }
    if (!links(target, markup)) continue;
    const titleMarkup = markup.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? markup;
    const title = plainText(titleMarkup);
    if (title.length < 12 || title.length > 240 || articles.has(target.href)) continue;
    const date = target.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)?.slice(1).join('-') ?? '';
    articles.set(target.href, { title, url: target.href, date, source, topics: [] });
    if (articles.size === 24) break;
  }
  return [...articles.values()];
}

const cache = new Map();
async function loadFeed(feed) {
  const { url, source } = feed;
  const cached = cache.get(url);
  if (cached && Date.now() < cached.expires) return { source, articles: cached.articles, available: true };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Feed unavailable');
    const body = await response.text();
    const articles = feed.links ? parsePage(body, feed) : parseFeed(body, source);
    if (!articles.length) throw new Error('Feed empty');
    cache.set(url, { articles, expires: Date.now() + 300_000 });
    return { source, articles, available: true };
  } catch {
    return { source, articles: cached?.articles ?? [], available: false };
  }
}
export async function readFeeds() {
  const results = await Promise.all(feeds.map(loadFeed));
  const articles = results.flatMap((result) => result.articles)
    .sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0));
  const sources = results.map(({ source, available, articles }, index) =>
    ({ source, available, count: articles.length, home: feeds[index].home }));
  return { articles, sources };
}
