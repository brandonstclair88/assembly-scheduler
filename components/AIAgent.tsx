'use client';
import React, { useRef, useState } from 'react';
import { AppData, ScheduledItem } from '../lib/types';
import { previewSmartAssignSuggestions, SmartAssignSuggestion } from '../lib/smartAssign';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIAgentProps {
  data: AppData;
  schedule: ScheduledItem[];
  onClose: () => void;
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────
// Summarises just enough of the live scheduler state for the AI to reason about.
// We keep it compact to stay well within the token budget.

function buildSnapshot(data: AppData, schedule: ScheduledItem[], suggestions: SmartAssignSuggestion[]) {
  const today = new Date().toISOString().slice(0, 10);

  // Employee summary
  const employees = (data.employees || []).filter((e: any) => e.active !== false).map((e: any) => ({
    id: e.id,
    name: e.name,
    canBuild: e.canBuild !== false,
    canFinalize: e.canFinalize !== false,
    canShip: e.canShip !== false,
    preferredProjects: (e.preferredProjectIds || '').split(/[\n,;\s]+/).filter(Boolean),
    limitToPreferred: !!e.limitAutoAssignToTrainedProjects,
  }));

  // Project summary
  const projects = (data.projects || [])
    .filter((p: any) => !p.archived && p.status !== 'Complete')
    .map((p: any) => ({
      id: p.id,
      code: p.projectId,
      name: p.name,
      priority: p.priority,
      dueDate: p.dueDate,
      status: p.status,
    }));

  // Assembly summary — only unfinished ones that need attention
  const assemblies = (data.projectAssemblies || [])
    .filter((a: any) => a.status !== 'Complete' && Number(a.percent || 0) < 100)
    .map((a: any) => {
      const proj = (data.projects || []).find((p: any) => p.id === a.projectId);
      return {
        id: a.id,
        projectCode: proj?.projectId || a.projectId,
        partNumber: a.partNumber,
        description: a.description,
        type: a.type,
        phase: a.type,
        assignedTo: a.assignedTo || '(unassigned)',
        finalizingAssignedTo: a.finalizingRequired ? (a.finalizingAssignedTo || '(unassigned)') : undefined,
        shippingAssignedTo: a.shippingRequired ? (a.shippingAssignedTo || '(unassigned)') : undefined,
        status: a.status,
        percent: a.percent,
        shipDate: a.shipDate,
        locked: !!a.locked,
        smartAssignProtected: !!a.smartAssignProtected,
        manuallyScheduled: !!a.manuallyScheduled,
        finalizingRequired: !!a.finalizingRequired,
        shippingRequired: !!a.shippingRequired,
      };
    });

  // Smart assign suggestion summary
  const suggestionSummary = {
    total: suggestions.length,
    suggested: suggestions.filter(s => s.status === 'suggested').length,
    blocked: suggestions.filter(s => s.status === 'blocked').length,
    byDiagnostic: {} as Record<string, number>,
    byPhase: {} as Record<string, number>,
    examples: [] as any[],
  };
  for (const s of suggestions) {
    suggestionSummary.byDiagnostic[s.diagnostic] = (suggestionSummary.byDiagnostic[s.diagnostic] || 0) + 1;
    suggestionSummary.byPhase[s.phase] = (suggestionSummary.byPhase[s.phase] || 0) + 1;
  }
  // Include up to 15 actionable suggestions as examples
  suggestionSummary.examples = suggestions
    .filter(s => s.status === 'suggested')
    .slice(0, 15)
    .map(s => ({
      project: s.projectCode,
      part: s.partNumber,
      description: s.description,
      phase: s.phase,
      from: s.currentEmployeeName || '(unassigned)',
      to: s.employeeName || '(none)',
      diagnostic: s.diagnostic,
      reason: s.reason,
      shipDate: s.shipDate,
      preferredMatch: s.preferredMatch,
    }));

  // Late / at-risk assemblies
  const lateItems = schedule
    .filter(item => item.isLate && !item.lateAllowed)
    .slice(0, 10)
    .map(item => ({
      project: item.projectName,
      part: item.partNumber,
      description: item.description || '',
      phase: item.phase || 'Build',
      scheduledEnd: item.scheduledEnd,
      shipDate: item.shipDate || '',
    }));

  // Unassigned items
  const unassigned = assemblies.filter(a => a.assignedTo === '(unassigned)').slice(0, 20);

  return {
    today,
    employees,
    projects,
    assemblySummary: {
      total: assemblies.length,
      unassigned: unassigned.length,
      locked: assemblies.filter(a => a.locked).length,
      manuallyScheduled: assemblies.filter(a => a.manuallyScheduled).length,
    },
    unassigned,
    smartAssign: suggestionSummary,
    lateItems,
    settings: data.settings,
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(snapshot: ReturnType<typeof buildSnapshot>) {
  return `You are an expert production scheduler AI assistant embedded inside an Assembly Scheduler application used by a manufacturing shop floor.

Your specialty is analyzing Smart Assign quality and identifying missed assignment opportunities. You have access to a live snapshot of the scheduler state below.

SCHEDULER SNAPSHOT (as of ${snapshot.today}):
${JSON.stringify(snapshot, null, 2)}

KEY CONCEPTS you must understand:
- Smart Assign is the app's AI assignment engine. It suggests which employee should handle each assembly phase (Build / Finalizing / Shipping) based on qualifications, preferred projects, capacity, and ship dates.
- A suggestion with status "suggested" is actionable — the engine recommends a change.
- Diagnostics like "no_preferred_employee_available" or "no_qualified_builder_available" mean the engine is blocked.
- "smart_assign_available" = the engine has a better assignment than the current one.
- "already_good" = the current assignment is already optimal.
- Assemblies that are unassigned, on hold, late, or lack qualified employees are the highest-priority issues.
- Employees can be restricted to preferred projects (limitToPreferred). This often causes "blocked" suggestions.
- Locked or smartAssignProtected assemblies cannot be auto-reassigned.

YOUR ROLE:
- Analyze the Smart Assign suggestion data and the overall schedule state.
- Identify patterns: why is Smart Assign blocked? Which employees are underutilized? Which projects are at risk?
- Give concrete, actionable recommendations a shop manager can act on immediately.
- Be specific: name employees, projects, part numbers, and phases when you can.
- Keep answers focused and practical — this is a busy shop floor, not a strategy meeting.
- When asked follow-up questions, drill into the data you have. Don't make up data not in the snapshot.
- Format responses clearly with short paragraphs and bullet points where it helps readability.
- If the user asks something outside the scope of this scheduler data, politely redirect to what you can help with.`;
}

// ─── API call ─────────────────────────────────────────────────────────────────
// Routed through our own /api/ai-agent server endpoint so the Anthropic API key
// stays server-side. Calling api.anthropic.com directly from the browser would
// require exposing the key to every client and would also be blocked by CORS.

async function callClaude(messages: Message[], systemPrompt: string): Promise<string> {
  const response = await fetch('/api/ai-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `API error ${response.status}`);
  }

  return json.reply || '';
}

// ─── Starter questions ────────────────────────────────────────────────────────

const STARTER_QUESTIONS = [
  'What are the top Smart Assign opportunities I should act on today?',
  'Why is Smart Assign blocked for some assemblies?',
  'Which employees are underutilized right now?',
  'Which projects are at highest risk of missing their ship date?',
  'Are there unassigned assemblies I should prioritize?',
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIAgent({ data, schedule, onClose }: AIAgentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build once per render (memoised by parent passing stable refs)
  const suggestions = previewSmartAssignSuggestions(data, schedule);
  const snapshot = buildSnapshot(data, schedule, suggestions);
  const systemPrompt = buildSystemPrompt(snapshot);

  async function send(text: string) {
    const userMsg: Message = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const reply = await callClaude(next, systemPrompt);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    send(text);
  }

  // Simple markdown-lite renderer: bold **x**, newlines, bullet points
  function renderContent(text: string) {
    return text.split('\n').map((line, i) => {
      const parts = line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
        j % 2 === 1 ? <strong key={j}>{part}</strong> : part
      );
      const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ');
      if (isBullet) {
        const content = line.replace(/^\s*[-•]\s*/, '');
        const formatted = content.split(/\*\*(.+?)\*\*/g).map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        );
        return <li key={i} style={{ marginBottom: 2 }}>{formatted}</li>;
      }
      return line ? <p key={i} style={{ margin: '4px 0' }}>{parts}</p> : <br key={i} />;
    });
  }

  const stats = {
    suggested: suggestions.filter(s => s.status === 'suggested').length,
    blocked: suggestions.filter(s => s.status === 'blocked').length,
    unassigned: (data.projectAssemblies || []).filter((a: any) => !a.assignedTo && a.status !== 'Complete').length,
    late: schedule.filter(s => s.isLate && !s.lateAllowed).length,
  };

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 420, maxHeight: '80vh',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg, #fff)', border: '1px solid var(--border, #ddd)',
      borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      zIndex: 9999, fontFamily: 'inherit', fontSize: 14,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border, #eee)',
        background: 'var(--accent, #2563eb)', color: '#fff',
        borderRadius: '12px 12px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Smart Assign AI Agent</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Analyzes your schedule in real time</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13,
        }}>✕</button>
      </div>

      {/* Live stats bar */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--border, #eee)',
        background: 'var(--surface, #f8f9fa)',
      }}>
        {[
          { label: 'Suggestions', value: stats.suggested, color: '#2563eb' },
          { label: 'Blocked', value: stats.blocked, color: '#d97706' },
          { label: 'Unassigned', value: stats.unassigned, color: '#dc2626' },
          { label: 'Late', value: stats.late, color: '#7c3aed' },
        ].map(stat => (
          <div key={stat.label} style={{
            flex: 1, textAlign: 'center', padding: '8px 4px',
            borderRight: '1px solid var(--border, #eee)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 10, color: 'var(--muted, #888)', lineHeight: 1.2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10,
        minHeight: 200,
      }}>
        {messages.length === 0 && (
          <div>
            <p style={{ color: 'var(--muted, #666)', fontSize: 13, marginBottom: 10 }}>
              Ask me anything about your Smart Assign opportunities, or pick a question:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {STARTER_QUESTIONS.map(q => (
                <button key={q} onClick={() => send(q)} style={{
                  textAlign: 'left', background: 'var(--surface, #f0f4ff)',
                  border: '1px solid var(--border, #c7d7fc)', borderRadius: 8,
                  padding: '7px 11px', cursor: 'pointer', fontSize: 12,
                  color: 'var(--fg, #1e3a8a)',
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
          }}>
            <div style={{
              padding: '8px 12px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? 'var(--accent, #2563eb)' : 'var(--surface, #f3f4f6)',
              color: msg.role === 'user' ? '#fff' : 'var(--fg, #111)',
              fontSize: 13, lineHeight: 1.5,
            }}>
              {msg.role === 'assistant'
                ? <ul style={{ margin: 0, paddingLeft: 16 }}>{renderContent(msg.content)}</ul>
                : msg.content
              }
            </div>
          </div>
        ))}

        {loading && (
          <div style={{
            alignSelf: 'flex-start', padding: '8px 14px',
            background: 'var(--surface, #f3f4f6)', borderRadius: '12px 12px 12px 2px',
            color: 'var(--muted, #888)', fontSize: 13,
          }}>
            Analyzing your schedule…
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: '#fef2f2', border: '1px solid #fca5a5',
            color: '#dc2626', fontSize: 12,
          }}>
            ⚠ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex', gap: 8, padding: '10px 12px',
        borderTop: '1px solid var(--border, #eee)',
        background: 'var(--surface, #f8f9fa)',
        borderRadius: '0 0 12px 12px',
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about Smart Assign, assignments, risks…"
          disabled={loading}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--border, #ddd)', outline: 'none',
            background: 'var(--bg, #fff)', color: 'var(--fg, #111)',
          }}
        />
        <button type="submit" disabled={loading || !input.trim()} style={{
          padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: 'var(--accent, #2563eb)', color: '#fff',
          border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading || !input.trim() ? 0.5 : 1,
        }}>
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
