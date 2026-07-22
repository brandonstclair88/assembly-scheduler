// Single home for assembly mutation rules: percent/status sync, group ship-date
// propagation, and hold-list synchronization. Every UI path that edits an assembly
// (Projects page, Weekly Board detail panel) should go through applyAssemblyPatch
// so the rules can never drift between pages.
const uid = (p: string) => p + '-' + Math.random().toString(36).slice(2, 9);

export function clampPercentInput(value: any) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

export function syncAssemblyPercentStatus(current: any, patch: any) {
  if (!('percent' in patch)) return patch;
  const nextPercent = clampPercentInput(patch.percent);
  const percentValue = nextPercent === null ? 0 : nextPercent;
  const nextPatch: any = { ...patch, percent: percentValue };
  if (percentValue >= 100) nextPatch.status = 'Complete';
  else if (percentValue > 0 && percentValue < 100) nextPatch.status = 'In Progress';
  else if (percentValue === 0 && patch.status === 'Complete') nextPatch.status = current?.status === 'Complete' ? 'Not Started' : current?.status;
  return nextPatch;
}

export function applyAssemblyPatch(d: any, id: string, patch: any) {
  const current = d.projectAssemblies.find((a: any) => a.id === id);
  const nextPatch = syncAssemblyPercentStatus(current, patch);
  let updated = d.projectAssemblies.map((a: any) => a.id === id ? { ...a, ...nextPatch, instanceLabel: nextPatch.instanceNumber ? '#' + nextPatch.instanceNumber : (nextPatch.instanceLabel ?? a.instanceLabel) } : a);
  const changed = updated.find((a: any) => a.id === id);
  if (changed?.type === 'Top Level Assembly' && ('shipDate' in nextPatch || 'lateAllowed' in nextPatch || 'batchId' in nextPatch)) {
    updated = updated.map((a: any) => a.buildGroupId && a.buildGroupId === changed.buildGroupId && a.id !== id ? { ...a, ...(('shipDate' in nextPatch) ? { shipDate: nextPatch.shipDate } : {}), ...(('lateAllowed' in nextPatch) ? { lateAllowed: nextPatch.lateAllowed } : {}), ...(('batchId' in nextPatch) ? { batchId: nextPatch.batchId } : {}) } : a);
  }
  const nextAsm = updated.find((a: any) => a.id === id);
  let holds = d.holds || [];
  const wantsHold = nextAsm && (nextAsm.status === 'On Hold' || String(nextAsm.holdReason || '').trim());
  if (nextAsm && wantsHold) {
    const existing = holds.find((h: any) => h.assemblyId === id && h.status !== 'Closed');
    const reason = nextAsm.holdReason || 'On hold';
    if (existing) holds = holds.map((h: any) => h.id === existing.id ? { ...h, projectId: nextAsm.projectId, reason, status: 'Open' } : h);
    else holds = [...holds, { id: uid('hold'), projectId: nextAsm.projectId, assemblyId: id, reason, owner: '', status: 'Open', notes: '' }];
  } else if (current && (nextPatch.status && nextPatch.status !== 'On Hold')) {
    holds = holds.map((h: any) => h.assemblyId === id && h.status !== 'Closed' ? { ...h, status: 'Closed' } : h);
  }
  return { ...d, projectAssemblies: updated, holds };
}
