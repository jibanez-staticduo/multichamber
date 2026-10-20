let resolveNativeSurface = () => null;
let listNativeSessions = async () => [];

/** The server composes native owners once; clients resolve them at call time. */
export const configureSessionHarnesses = (resolve, list = async () => []) => { resolveNativeSurface = resolve; listNativeSessions = list; };
export const readNativeActivity = async (sessionID) => {
  const owner = resolveNativeSurface(sessionID);
  return owner ? owner.sessionClient.activity(sessionID) : null;
};
export const isNativeSession = (id) => Boolean(resolveNativeSurface(id));
export const nativeSessionOperation = async (fetchPath, { method = 'GET', body, query } = {}) => {
  const match = /^\/api\/session\/([^/]+)(?:\/(message)(?:\/([^/]+))?|\/(synthetic|prompt))?$/.exec(fetchPath);
  if (!match) return { handled: false };
  const sessionID = decodeURIComponent(match[1]);
  const owner = resolveNativeSurface(sessionID);
  if (!owner) return { handled: false };
  if (match[4] && method === 'POST') {
    if (match[4] === 'prompt') return { handled: true, value: await owner.sessionClient.prompt(sessionID, body) };
    await owner.sessionClient.synthetic(sessionID, body.text || ''); return { handled: true, value: {} };
  }
  if (method !== 'GET') throw new Error('Unsupported native session operation');
  if (!match[2]) return { handled: true, value: await owner.sessionClient.get(sessionID) };
  const page = await owner.sessionClient.messages(sessionID, query || {});
  if (!match[3]) return { handled: true, value: page };
  const value = page.data.find((entry) => entry.id === decodeURIComponent(match[3]));
  if (!value) throw new Error('Pinned native message not found');
  return { handled: true, value };
};

export const withSessionHarnesses = (client) => {
  const ownerOf = (params) => resolveNativeSurface(params?.sessionID);
  const readMessage = async (params) => {
    const owner = ownerOf(params);
    if (!owner) return client.session.message.get(params);
    const page = await owner.sessionClient.messages(params.sessionID, { order: 'asc' });
    const message = page.data.find((entry) => entry.id === params.messageID);
    if (!message) throw Object.assign(new Error('Message not found'), { status: 404 });
    return message;
  };
  const session = new Proxy(client.session, {
    get(target, key) {
      if (key === 'message') return { ...target.message, get: readMessage };
      if (key === 'list') return async (params, options) => {
        const page = await target.list(params, options);
        if (params?.cursor || params?.parentID) return page;
        const native = await listNativeSessions();
        const seen = new Set(page.data.map((entry) => entry.id));
        return { ...page, data: [...page.data, ...native.filter((entry) => !seen.has(entry.id))] };
      };
      if (key === 'get') return (params, options) => {
        const owner = ownerOf(params);
        return owner ? owner.sessionClient.get(params.sessionID) : target.get(params, options);
      };
      const method = target[key];
      if (typeof method !== 'function') return method;
      return (params, options) => {
        if (ownerOf(params)) throw Object.assign(new Error(`The native harness does not support session.${String(key)} through this workflow`), { status: 400, code: 'unsupported_harness_operation' });
        return method.call(target, params, options);
      };
    },
  });
  const message = { ...client.message, list: (params, options) => {
    const owner = ownerOf(params);
    return owner ? owner.sessionClient.messages(params.sessionID, params) : client.message.list(params, options);
  } };
  return { ...client, session, message };
};
