import os from 'node:os';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLanAddress(value: string) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(value);
}

function interfaceScore(name: string) {
  if (/^en0$/i.test(name)) return 0;
  if (/^en1$/i.test(name)) return 1;
  if (/wi-?fi|wlan|wireless/i.test(name)) return 2;
  if (/ethernet/i.test(name)) return 3;
  return 10;
}

function lanIpv4Candidates() {
  const interfaces = os.networkInterfaces();
  const addresses: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue;
      if (isLanAddress(entry.address)) addresses.push({ name, address: entry.address });
    }
  }
  return addresses.sort((a, b) => interfaceScore(a.name) - interfaceScore(b.name) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host || 'localhost:3000';
  const protocol = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'http') as 'http' | 'https';
  const port = host.includes(':') ? host.split(':')[1] : (protocol === 'https' ? '443' : '3000');
  const candidates = lanIpv4Candidates();
  const lanIp = candidates[0]?.address || '';
  const lanUrl = lanIp ? `${protocol}://${lanIp}:${port}/mobile` : '';
  const localhostUrl = `${protocol}://localhost:${port}/mobile`;
  return NextResponse.json(
    {
      ok: true,
      lanIp,
      lanUrl,
      lanCandidates: candidates.map(candidate => ({
        interface: candidate.name,
        ip: candidate.address,
        url: `${protocol}://${candidate.address}:${port}/mobile`,
      })),
      localhostUrl,
      sameWifiNote: 'Phone must be on the same Wi-Fi.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
