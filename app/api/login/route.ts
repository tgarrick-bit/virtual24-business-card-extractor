import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionValue } from '@/lib/session';

export async function POST(request: NextRequest) {
  const accessCode = process.env.BCX_ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.json({ error: 'access_code_not_configured' }, { status: 503 });
  }

  let code = '';
  try {
    const body = await request.json();
    code = typeof body?.code === 'string' ? body.code : '';
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const given = Buffer.from(code);
  const expected = Buffer.from(accessCode);
  const match = given.length === expected.length && timingSafeEqual(given, expected);
  if (!match) {
    return NextResponse.json({ error: 'wrong_code' }, { status: 401 });
  }

  const secret = process.env.BCX_SESSION_SECRET || accessCode;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionValue(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  });
  return response;
}
