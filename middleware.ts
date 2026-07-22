import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Lightweight shared-password gate for the whole app (pages + API routes).
// Set SITE_PASSWORD in your environment (.env.local locally, host env vars in
// production) to turn this on. If SITE_PASSWORD is unset, the app stays open
// (so local development keeps working without extra setup).
export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  // Accept any username; only the password matters.
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      const sep = decoded.indexOf(':');
      if (sep >= 0 && decoded.slice(sep + 1) === password) return NextResponse.next();
    } catch {}
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Assembly Scheduler"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
