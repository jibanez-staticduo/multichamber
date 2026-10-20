import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { SessionEngine } from '@/lib/sessionEngine';
import { SessionTimelineRowBody } from './SessionTimelineRowBody';

let browser: Window;
let root: Root;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  browser = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const title = 'درخواست پاسخ فارسی با React';

const renderRow = (compact: boolean, projectLine = false, engine?: SessionEngine, branchLabel: string | null = null) => root.render(<SessionTimelineRowBody
  compact={compact}
  project={null}
  projectLabel={projectLine ? 'openchamber' : null}
  projectLine={projectLine}
  title={title}
  titleClassName=""
  engine={engine}
  branchLabel={branchLabel}
  statusDot={null}
  pinnedMarker={null}
  timeSlot="1m"
  directoryIndicator={null}
  prBadge={null}
  zombieIndicator={null}
  badges={null}
  hideMetaOnHoverClass=""
/>);

// A truncated title in an LTR box clips an RTL title's beginning, because its
// first word sits at the right edge. dir=auto lets the title own its direction.
for (const [compact, projectLine] of [[true, false], [false, false], [false, true]] as const) {
  test(`the title resolves its own direction (compact: ${compact}, project line: ${projectLine})`, async () => {
    await act(async () => renderRow(compact, projectLine));
    // The innermost box holding the title is the one that truncates it.
    const element = Array.from(document.querySelectorAll('div')).reverse().find((node) => node.textContent === title);
    expect(element?.getAttribute('dir')).toBe('auto');
  });
}

// The list by time names the project above the title, with the time beside
// it, and keeps the branch line, so a row has three lines.
test('a project line puts the project and time above the title', async () => {
  await act(async () => renderRow(false, true));
  const lines = Array.from(document.querySelector('.flex-col')?.children ?? []).map((line) => line.textContent);
  expect(lines).toEqual(['openchamber1m', title]);
});


for (const engine of ['opencode', 'claude', 'codex'] as const) {
  test(`${engine} stays with title and time without creating an empty detail line`, async () => {
    await act(async () => renderRow(false, false, engine));
    const body = document.querySelector('.flex-col');
    expect(body?.children).toHaveLength(1);
    const titleLine = body?.firstElementChild;
    expect(titleLine?.textContent).toContain(title);
    expect(titleLine?.textContent).toContain('1m');
    expect(titleLine?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(engine === 'opencode' ? 'OpenCode' : engine === 'claude' ? 'Claude Code' : 'Codex');
  });
}

test('a real branch remains on its own detail line', async () => {
  await act(async () => renderRow(false, false, 'codex', 'main'));
  const lines = [...(document.querySelector('.flex-col')?.children ?? [])];
  expect(lines).toHaveLength(2);
  expect(lines[0].textContent).toContain(title);
  expect(lines[1].textContent).toBe('main');
  expect(lines[1].querySelector('[role="img"]')).toBeNull();
});


test('run lane detail and state badges remain visible without reserving a logo-only line', async () => {
  await act(async () => root.render(<SessionTimelineRowBody
    project={null} projectLabel={null} title="Run" titleClassName="" branchLabel={null}
    metaLineLead={<span>3 lanes</span>} statusDot={null} pinnedMarker={null} timeSlot="1m"
    directoryIndicator={null} prBadge={<span>PR 7</span>} zombieIndicator={null}
    goal={<span>Goal</span>} badges={<span>Pending</span>} engine="codex" hideMetaOnHoverClass=""
  />));
  const lines = [...(document.querySelector('.flex-col')?.children ?? [])];
  expect(lines).toHaveLength(2);
  expect(lines[0].textContent).toContain('PR 7');
  expect(lines[0].textContent).toContain('Goal');
  expect(lines[0].textContent).toContain('Pending');
  expect(lines[1].textContent).toBe('3 lanes');
});
