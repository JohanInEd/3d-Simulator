import type { CSSProperties } from 'react';
import { useSandboxStore } from '../state/useSandboxStore';
import { TOOL_PROFILES } from '../tools/toolProfiles';

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  fontFamily: 'system-ui, sans-serif',
  color: '#e2e8f0',
};

const crosshairStyle = (active: boolean): CSSProperties => ({
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: active ? 10 : 6,
  height: active ? 10 : 6,
  borderRadius: '50%',
  transform: 'translate(-50%, -50%)',
  background: active ? '#22d3ee' : 'rgba(255, 255, 255, 0.55)',
  boxShadow: active ? '0 0 8px rgba(34, 211, 238, 0.9)' : 'none',
  transition: 'all 80ms ease-out',
});

const promptStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '12%',
  transform: 'translateX(-50%)',
  padding: '8px 16px',
  borderRadius: 8,
  background: 'rgba(10, 14, 20, 0.7)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  fontSize: 14,
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
};

/**
 * DOM overlay (lives outside the Canvas — zustand bridges the two trees).
 * Re-renders only when held/aimed/lock state actually changes.
 */
export function Hud() {
  const pointerLocked = useSandboxStore((state) => state.pointerLocked);
  const aimedItem = useSandboxStore((state) =>
    state.aimedItemId ? state.items[state.aimedItemId] : null,
  );
  const heldItem = useSandboxStore((state) =>
    state.heldItemId ? state.items[state.heldItemId] : null,
  );

  let prompt: string | null = null;
  if (!pointerLocked) {
    prompt = 'Click to enter — WASD move · Space jump · E grab/drop · LMB use tool';
  } else if (heldItem) {
    const profile = heldItem.profileId ? TOOL_PROFILES[heldItem.profileId] : null;
    prompt = profile
      ? `${heldItem.label} [${profile.label}] — LMB use · E drop`
      : `${heldItem.label} — E drop`;
  } else if (aimedItem) {
    prompt = `E — pick up ${aimedItem.label}`;
  }

  return (
    <div style={overlayStyle}>
      {pointerLocked && <div style={crosshairStyle(aimedItem !== null)} />}
      {prompt && <div style={promptStyle}>{prompt}</div>}
    </div>
  );
}
