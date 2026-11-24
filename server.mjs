import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';

import { readFeeds } from './feeds.mjs';

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/motion.js', ['motion.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const hosted = process.env.RENDER === 'true';
const digest = (text) => createHash('sha256').update(text).digest();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (hosted) {
    const password = process.env.NEWS_DESK_PASSWORD;
    if (!password) return res.writeHead(503).end('Site password is not configured.');
    const authorization = req.headers.authorization ?? '';
    const encoded = authorization.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1] ?? '';
    const credentials = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    const username = separator < 0 ? '' : credentials.slice(0, separator).toLowerCase();
    if (username !== 'howard' || !timingSafeEqual(digest(credentials.slice(separator + 1)), digest(password))) {
      return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="News Desk"', 'Cache-Control': 'no-store' }).end('Sign in to News Desk.');
    }
  }
  if (path === '/api/feed') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await readFeeds()));
    return;
  }
  const route = routes.get(path);
  if (!route) return res.writeHead(404).end('Not found');
  try {
    const body = await readFile(new URL(route[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': route[1] + '; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(500).end('Unable to load app');
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? process.env.NEWSLETTER_PORT ?? 4173);
  const host = hosted ? '0.0.0.0' : '127.0.0.1';
  server.listen(port, host, () => console.log('http://' + host + ':' + server.address().port));
}
