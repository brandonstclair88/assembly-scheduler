import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = { role: 'user' | 'assistant'; content: string };

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'ANTHROPIC_API_KEY is not configured on the server. Add it to a .env.local file (ANTHROPIC_API_KEY=sk-ant-...) and restart the app to enable the AI Agent.',
        },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const body = await request.json().catch(() => null);
    const messages: Message[] = Array.isArray(body?.messages) ? body.messages : [];
    const systemPrompt: string = typeof body?.systemPrompt === 'string' ? body.systemPrompt : '';

    if (!messages.length) {
      return NextResponse.json(
        { ok: false, error: 'No messages provided.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: json?.error?.message || `Anthropic API error ${response.status}` },
        { status: response.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const reply = (json?.content || [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');

    return NextResponse.json(
      { ok: true, reply },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'AI Agent request failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
