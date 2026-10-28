import path from 'node:path';
import { readFile } from 'node:fs/promises';
import auth from '../../lib/auth.cjs';
const { getSession } = auth;
const dashboardFile = path.join(process.cwd(), 'private', 'dashboard.html');

export default async function dashboard(request) {
  const user = getSession(request.headers.get('cookie') || '');
  if (!user) return Response.redirect(new URL('/', request.url), 303);
  const html = await readFile(dashboardFile, 'utf8');
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    }
  });
}
