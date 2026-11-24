import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { readFeeds } from './feeds.mjs';

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/motion.js', ['motion.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const hosted = process.env.RENDER === 'true';
const digest = (text) => createHash('sha256').update(text).digest();
const sessionKey = process.env.NEWS_DESK_SESSION_KEY || randomBytes(32);
const sessionAge = 7 * 24 * 60 * 60;
const cookieName = '__Host-newsdesk';
const signature = (value, password) => createHmac('sha256', sessionKey).update(value + ':' + password).digest('base64url');
const authenticated = (cookie, password) => {
  const token = cookie.split(/;\s*/).find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const match = token?.match(/^(\d+)\.([A-Za-z0-9_-]{43})$/);
  return Boolean(match && Number(match[1]) > Date.now() && timingSafeEqual(digest(match[2]), digest(signature(match[1], password))));
};
const sessionCookie = (token, age) => cookieName + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + age;
function validLogin(username, guess, password) {
  return username.trim().toLowerCase() === 'howard' && timingSafeEqual(digest(guess), digest(password));
}

async function showLogin(res, next, error = false) {
  const page = await readFile(new URL('login.html', import.meta.url), 'utf8');
  const body = page.replace('__NEXT__', encodeURIComponent(next))
    .replace('__ERROR__', error ? '<p class="login-error" role="alert">Check your username and password, then try again.</p>' : '');
  res.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (hosted) {
    const password = process.env.NEWS_DESK_PASSWORD;
    if (!password) return res.writeHead(503).end('Site password is not configured.');
    if (path === '/login' && req.method === 'POST') {
      const next = url.searchParams.get('next') ?? '/';
      const destination = /^\/(?![\/\\])[^\r\n\\]*$/.test(next) ? next : '/';
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) {
            res.writeHead(413).end('Sign-in request is too large.');
            return;
          }
        }
        const form = new URLSearchParams(body);
        if (!validLogin(form.get('username') ?? '', form.get('password') ?? '', password)) {
          return await showLogin(res, destination, true);
        }
        const expires = String(Date.now() + sessionAge * 1000);
        return res.writeHead(303, { Location: destination, 'Set-Cookie': sessionCookie(expires + '.' + signature(expires, password), sessionAge), 'Cache-Control': 'no-store' }).end();
      } catch {
        return res.writeHead(500).end('Unable to sign in. Try again.');
      }
    }
    if (path === '/logout' && req.method === 'POST') {
      return res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie('', 0), 'Cache-Control': 'no-store' }).end();
    }
    const authorization = req.headers.authorization ?? '';
    const encoded = authorization.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1] ?? '';
    const credentials = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    const basic = path === '/api/feed' && separator >= 0 &&
      validLogin(credentials.slice(0, separator), credentials.slice(separator + 1), password);
    if (!basic && !authenticated(req.headers.cookie ?? '', password)) {
      if (path === '/') {
        try { return await showLogin(res, url.pathname + url.search); }
        catch { return res.writeHead(500).end('Unable to load sign-in.'); }
      }
      return res.writeHead(401, { 'Cache-Control': 'no-store' }).end('Sign in to News Desk.');
    }
  }
  if (path === '/api/feed') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': hosted ? 'private, no-store' : 'no-cache' }).end(JSON.stringify(await readFeeds()));
    return;
  }
  const route = routes.get(path);
  if (!route) return res.writeHead(404).end('Not found');
  try {
    const file = await readFile(new URL(route[0], import.meta.url));
    const body = hosted && path === '/' ? file.toString().replace('id="sign-out" hidden', 'id="sign-out"') : file;
    res.writeHead(200, { 'Content-Type': route[1] + '; charset=utf-8', 'Cache-Control': hosted ? 'private, no-store' : 'no-cache' }).end(body);
  } catch {
    res.writeHead(500).end('Unable to load app');
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? process.env.NEWSLETTER_PORT ?? 4173);
  const host = hosted ? '0.0.0.0' : '127.0.0.1';
  server.listen(port, host, () => console.log('http://' + host + ':' + server.address().port));
}
