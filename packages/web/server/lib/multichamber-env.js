/** Canonical variables win; legacy names remain an internal compatibility seam. */
export const normalizeMultichamberEnv = (env = process.env) => {
  for (const name of Object.keys(env)) {
    if (!/^MULTICHAMBER_[A-Z0-9_]+$/.test(name) || env[name] === undefined) continue;
    env[`OPENCHAMBER_${name.slice('MULTICHAMBER_'.length)}`] = env[name];
  }
  return env;
};

// Import this before modules that capture environment values at evaluation.
normalizeMultichamberEnv();
