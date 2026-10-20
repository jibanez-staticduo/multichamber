// Shared pieces of the bun:test + happy-dom behaviour tests of dialogs: the DOM
// install/restore, the renderer pre-import, and the form-kit mocks. Import it
// first in the test file; every call is explicit so a test reads top to bottom.
import { Window } from 'happy-dom';

const swapGlobals = (names: readonly string[], values: Record<string, unknown>) => {
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of names) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
};

// React detects input-event support when its DOM renderer is first imported.
// Give that probe a document, then restore the caller's globals immediately.
const rendererWindow = new Window();
const restoreRendererGlobals = swapGlobals(['window', 'document'], { window: rendererWindow, document: rendererWindow.document });
export const { createRoot } = await import('react-dom/client');
restoreRendererGlobals();
rendererWindow.close();

const DOM_GLOBAL_NAMES = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'KeyboardEvent', 'Event', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT',
] as const;

/** A happy-dom window installed as the globals, plus a mounted container; `restore` undoes both. */
export const installDom = () => {
  const happyWindow = new Window({ url: 'http://localhost' });
  const restoreGlobals = swapGlobals(DOM_GLOBAL_NAMES, {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    Node: happyWindow.Node,
    Element: happyWindow.Element,
    HTMLElement: happyWindow.HTMLElement,
    HTMLInputElement: happyWindow.HTMLInputElement,
    KeyboardEvent: happyWindow.KeyboardEvent,
    Event: happyWindow.Event,
    localStorage: happyWindow.localStorage,
    requestAnimationFrame: happyWindow.requestAnimationFrame.bind(happyWindow),
    cancelAnimationFrame: happyWindow.cancelAnimationFrame.bind(happyWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    restore: () => {
      happyWindow.close();
      restoreGlobals();
    },
  };
};
