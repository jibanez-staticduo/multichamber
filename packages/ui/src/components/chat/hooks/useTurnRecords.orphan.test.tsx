import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import { useTurnRecords } from './useTurnRecords';
import type { ChatMessageEntry } from '../lib/turns/types';

function assistant(id: string): ChatMessageEntry {
  return { info: { id, sessionID: 'ses_cdxchild', role: 'assistant', agent: 'worker', providerID: 'codex', modelID: 'sol', time: { created: 1, completed: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [{ id: `${id}-text`, sessionID: 'ses_cdxchild', messageID: id, type: 'text', text: id }] };
}

/** Exercises the same hook and tail split that feed MessageList's static and trailing entries. */
function Transcript({ messages, child = true }: { messages: ChatMessageEntry[]; child?: boolean }) {
  const { projection, staticTurns, streamingTurn } = useTurnRecords(messages, { sessionKey: 'ses_cdxchild', allowOrphanAssistantMessages: child, showTurnChangedFiles: false });
  return <div data-static-turns={staticTurns.length} data-streaming-turn={streamingTurn?.turnId ?? ''}>
    {messages.filter((message) => projection.ungroupedMessageIds.has(message.info.id)).map((message) => <article key={message.info.id}>{message.parts.map((part) => part.type === 'text' ? part.text : '').join('')}</article>)}
    {projection.turns.map((turn) => <section key={turn.turnId}>{turn.messages.map((entry) => entry.messageId).join(',')}</section>)}
  </div>;
}

test('native assistant-only history renders through the cached timeline hook, then a real user turn appears once', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const children = [assistant('first'), assistant('second')];
  const user: ChatMessageEntry = { info: { id: 'user', sessionID: 'ses_cdxchild', role: 'user', time: { created: 3 } }, parts: [] };
  try {
    await act(async () => root.render(<Transcript messages={children} child={false} />));
    expect(dom.container.querySelectorAll('article')).toHaveLength(0);
    await act(async () => root.render(<Transcript messages={children} />));
    expect([...dom.container.querySelectorAll('article')].map((node) => node.textContent)).toEqual(['first', 'second']);
    expect(dom.container.querySelector('[data-streaming-turn]')?.getAttribute('data-streaming-turn')).toBe('');
    await act(async () => root.render(<Transcript messages={[...children, user, assistant('reply')]} />));
    expect([...dom.container.querySelectorAll('article')].map((node) => node.textContent)).toEqual(['first', 'second']);
    expect([...dom.container.querySelectorAll('section')].map((node) => node.textContent)).toEqual(['user,reply']);
    expect(dom.container.querySelector('[data-streaming-turn]')?.getAttribute('data-streaming-turn')).toBe('user');
  } finally { await act(async () => root.unmount()); dom.restore(); }
});
