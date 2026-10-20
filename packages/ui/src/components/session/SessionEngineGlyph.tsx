import type { SessionEngine } from '@/lib/sessionEngine';
import claudeLogo from '@/assets/provider-logos/claude-code.svg';
import openaiLogo from '@/assets/provider-logos/openai.svg';

/** Local engine brands shared by source filters and session rows. */
export function SessionEngineGlyph({ engine, className }: { engine: SessionEngine; className?: string }) {
  if (engine === 'opencode') return (
    // Existing mark from docs/references/badges/created-with-opencode.svg.
    <svg viewBox="0 0 32 40" className={className} aria-hidden="true">
      <path d="M24 32H8V16H24V32Z" fill="currentColor" opacity="0.4" />
      <path d="M24 8H8V32H24V8ZM32 40H0V0H32V40Z" fill="currentColor" />
    </svg>
  );
  return <img src={engine === 'claude' ? claudeLogo : openaiLogo} alt="" aria-hidden="true" draggable={false} className={className ? `${className} object-contain dark:invert` : 'object-contain dark:invert'} />;
}
