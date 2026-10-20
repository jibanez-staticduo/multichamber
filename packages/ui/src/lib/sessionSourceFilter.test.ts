import { describe, expect, test } from 'bun:test';
import {
  filterSessionsBySource,
  hasMultipleSessionSources,
  resolveSessionSource,
} from './sessionSourceFilter';

describe('resolveSessionSource', () => {
  test('recognizes Codex session ids', () => {
    expect(resolveSessionSource({ id: 'ses_cdx01a02461ad4a755090aae4d440a84090' })).toBe('codex');
  });

  test('reconoce una sesión de Claude Code y también sus subagentes', () => {
    expect(resolveSessionSource({ id: 'ses_ccc8647ab8d1bdb4afd9c08ec1644a5bed4' })).toBe('claude');
    expect(resolveSessionSource({ id: 'ses_ccsa6ffcff7eb8fa7a61' })).toBe('claude');
  });

  test('trata como opencode cualquier id nativo', () => {
    expect(resolveSessionSource({ id: 'ses_fdbc3860bffehV4vp2SZOhrusN' })).toBe('opencode');
  });

  test('no clasifica por modelo: una sesión de opencode servida por claude-code sigue siendo de opencode', () => {
    // El id manda. Es lo que distingue "de quién es la sesión" de "con qué
    // modelo corre", que es lo que responde resolveSessionModelBadge.
    expect(resolveSessionSource({ id: 'ses_fdbc3860bffehV4vp2SZOhrusN' })).toBe('opencode');
  });

  test('sin id, opencode: es el caso de una sesión aún sin sincronizar y no puede desaparecer del listado', () => {
    expect(resolveSessionSource({})).toBe('opencode');
    expect(resolveSessionSource(null)).toBe('opencode');
  });

  test('exige el prefijo completo: `ses_cc` a secas no basta', () => {
    // Discriminar con 6 caracteres colaría cualquier id nativo que empiece por
    // `ses_cc`, y son ids aleatorios: pasa antes o después.
    expect(resolveSessionSource({ id: 'ses_ccffeX520w9wkbyx6Rf' })).toBe('opencode');
  });
});

test('declared backend wins over a native or conflicting id', () => {
  expect(resolveSessionSource({ id: 'ses_native', metadata: { backend: 'codex' } })).toBe('codex');
  expect(resolveSessionSource({ id: 'ses_cdx123', metadata: { backend: 'opencode' } })).toBe('opencode');
});

describe('filterSessionsBySource', () => {
  const sessions = [
    { id: 'ses_ccc0002' },
    { id: 'ses_ccs0003' },
    { id: 'ses_native0004' },
    { id: 'ses_cdx0005' },
  ];

  test('devuelve la lista intacta con `all`', () => {
    expect(filterSessionsBySource(sessions, 'all')).toBe(sessions);
  });

  test('filtra por herramienta', () => {
    expect(filterSessionsBySource(sessions, 'codex').map((s) => s.id)).toEqual(['ses_cdx0005']);
    expect(filterSessionsBySource(sessions, 'claude').map((s) => s.id)).toEqual(['ses_ccc0002', 'ses_ccs0003']);
    expect(filterSessionsBySource(sessions, 'opencode').map((s) => s.id)).toEqual(['ses_native0004']);
  });
});

describe('hasMultipleSessionSources', () => {
  test('es falso contra un opencode pelado, que es cuando el control debe esconderse', () => {
    expect(hasMultipleSessionSources([{ id: 'ses_a' }, { id: 'ses_b' }])).toBe(false);
  });

  test('es falso con la lista vacía', () => {
    expect(hasMultipleSessionSources([])).toBe(false);
  });

  test('es cierto en cuanto convive una de Claude con una nativa', () => {
    expect(hasMultipleSessionSources([{ id: 'ses_a' }, { id: 'ses_ccc1' }])).toBe(true);
  });
});

test('Codex and Claude expose the shared source filter without OpenCode sessions', () => {
  expect(hasMultipleSessionSources([{ id: 'ses_cdx1' }, { id: 'ses_ccc1' }])).toBe(true);
  expect(hasMultipleSessionSources([{ id: 'ses_cdx1' }, { id: 'ses_cdx2' }])).toBe(false);
});


test('Codex creation and error messages are translated in every shipped locale', async () => {
  const { dict: english } = await import('./i18n/messages/en');
  const locales = ['de', 'es', 'fr', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'tr', 'uk', 'zh-CN', 'zh-TW'];
  const keys = [
    'sessions.sidebar.project.actions.newCodexSession',
    'dialog.codexNew.title',
    'dialog.codexNew.description',
    'dialog.codexNew.failed',
    'dialog.codexNew.creating',
    'dialog.codexNew.create',
    'chat.codexMode.title',
    'chat.codexMode.readOnly',
    'chat.codexMode.workspace',
    'chat.codexMode.fullAccess',
    'chat.codexMode.changeFailed',
    'chat.codexModel.changeFailed',
    'chat.codexCatalog.failed',
  ] as const;
  for (const locale of locales) {
    const { dict } = await import(`./i18n/messages/${locale}.ts`);
    expect(dict['sessions.sidebar.header.sourceFilter.codex']).toBe('Codex');
    for (const key of keys) {
      expect(dict[key]).toBeTruthy();
      expect(dict[key]).not.toBe(english[key]);
    }
  }
});
