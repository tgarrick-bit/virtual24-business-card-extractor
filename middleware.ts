import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionValue } from '@/lib/session';

// Team access gate. Enforced only when BCX_ACCESS_CODE is configured, so local
// dev without env vars still works; any real deployment MUST set
// BCX_ACCESS_CODE and BCX_SESSION_SECRET (see .env.example).

const PUBLIC_PATHS = ['/login', '/api/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p)) return NextResponse.next();

  const accessCode = process.env.BCX_ACCESS_CODE;
  if (!accessCode) {
    // Unset means "open" in development only. A production deploy that forgets
    // the variable used to serve everything with no gate at all (2026-07-28
    // audit, fail-open finding); now it fails closed instead.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return NextResponse.json(
      { error: 'access_not_configured', detail: 'BCX_ACCESS_CODE is not set.' },
      { status: 503 }
    );
  }

  const secret = process.env.BCX_SESSION_SECRET || accessCode;
  const ok = await verifySessionValue(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|site.webmanifest|.*\\.(?:png|svg|jpg|jpeg|ico)$).*)'],
};
