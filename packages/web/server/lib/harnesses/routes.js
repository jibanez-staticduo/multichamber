import { z } from 'zod';

const idSchema = z.enum(['opencode', 'claude', 'codex']);
export const registerHarnessRoutes = (app, { manager, express, validateDefaults, nativeSurfaces = {} }) => {
  const handle = (operation) => async (req, res) => {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) return res.status(404).json({ message: 'Unknown harness' });
    try {
      if (operation === 'update' && req.body?.confirm !== true) return res.status(400).json({ message: 'Explicit confirmation is required' });
      const result = await manager[operation](parsed.data);
      return res.status(result.status === 'manual' || result.status === 'unsupported' ? 409 : 200).json(result);
    } catch (error) { return res.status(error.status || 502).json({ message: error.message }); }
  };
  app.get('/api/harnesses', async (_req, res) => {
    try { return res.json({ harnesses: await Promise.all(['opencode', 'claude', 'codex'].map((id) => manager.status(id))) }); }
    catch (error) { return res.status(502).json({ message: error.message }); }
  });
  app.post('/api/harnesses/:id/check', handle('check'));
  app.post('/api/harnesses/:id/update', express.json({ limit: '16kb' }), handle('update'));
  app.get('/api/harnesses/:id/sessions', async (req, res) => {
    const surface = nativeSurfaces[req.params.id];
    if (!surface) return res.status(400).json({ message: 'Use the OpenCode session API for this harness' });
    try {
      const data = await surface.list({ directory: req.query.directory || null, search: req.query.search || null });
      return res.json({ data, cursor: { previous: null, next: null }, harness: req.params.id });
    } catch (error) { return res.status(502).json({ message: error.message }); }
  });
  app.get('/api/harnesses/:id/active', async (req, res) => {
    const surface = nativeSurfaces[req.params.id];
    if (!surface) return res.status(400).json({ message: 'Use the OpenCode session API for this harness' });
    try { return res.json({ data: await surface.active({ directory: req.query.directory || null }), harness: req.params.id }); }
    catch (error) { return res.status(502).json({ message: error.message }); }
  });
  app.get('/api/harnesses/:id/pending/:kind', async (req, res) => {
    const surface = nativeSurfaces[req.params.id];
    if (!surface || !['permission', 'form'].includes(req.params.kind)) return res.status(400).json({ message: 'Unsupported harness pending list' });
    try { return res.json({ data: await surface.pending(req.params.kind, { directory: req.query.directory || null }), harness: req.params.id }); }
    catch (error) { return res.status(502).json({ message: error.message }); }
  });
  app.put('/api/config/settings', async (req, res, next) => {
    try { await validateDefaults(req.body || {}); return next(); }
    catch (error) { return res.status(400).json({ message: error.message }); }
  });
};

export const createDefaultsValidator = ({ claudeSurface, codexSurface, readSettings = async () => ({}) }) => async (patch) => {
  const saved = await readSettings();
  for (const [id, surface] of [['claude', claudeSurface], ['codex', codexSurface]]) {
    const keys = ['Model', 'Effort', 'Mode'].map((suffix) => `${id}Default${suffix}`);
    if (!keys.some((key) => Object.hasOwn(patch, key))) continue;
    for (const key of keys) if (Object.hasOwn(patch, key) && !z.string().max(256).safeParse(patch[key]).success) throw new Error(`Invalid ${key}`);
    const explicit = keys.some((key) => patch[key]);
    if (!explicit) continue;
    const catalog = await surface.getCatalog();
    const modelId = patch[keys[0]] || saved[keys[0]] || catalog.defaultModelId;
    const model = catalog.models.find((entry) => entry.id === modelId);
    if (patch[keys[0]] && !model) throw new Error(`Unknown ${id} model`);
    const effort = Object.hasOwn(patch, keys[1]) ? patch[keys[1]] : saved[keys[1]];
    const supported = model?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort) || catalog.efforts.map((entry) => entry.id);
    if (effort && !supported.includes(effort)) throw new Error(`Unsupported ${id} effort`);
    if (patch[keys[2]] && !catalog.modes.some((entry) => entry.id === patch[keys[2]])) throw new Error(`Unknown ${id} mode`);
  }
};
