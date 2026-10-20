const CANONICAL_PREFIX = '/api/multichamber';
const LEGACY_PREFIX = '/api/openchamber';

const legacyApiUrl = (url) => {
  if (!url.startsWith(CANONICAL_PREFIX)) return url;
  const boundary = url[CANONICAL_PREFIX.length];
  if (boundary && boundary !== '/' && boundary !== '?') return url;
  return `${LEGACY_PREFIX}${url.slice(CANONICAL_PREFIX.length)}`;
};

/** Run before auth so every route and URL-token gate sees the same API path. */
export const canonicalMultichamberApi = (req, _res, next) => {
  req.url = legacyApiUrl(req.url);
  req.originalUrl = legacyApiUrl(req.originalUrl);
  next();
};
