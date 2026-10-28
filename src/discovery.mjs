import { createHash } from 'node:crypto';

const UNSAFE_SCHEMES = /^(javascript|data|file|ftp):/i;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const SECRET_VALUE = /(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,})/gi;
const SECRET_ASSIGNMENT = /(password|secret|token|cookie|authorization|api[_-]?key|session)\s*[=:]\s*[^\s]+/gi;

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function hash(value) { return createHash('sha256').update(stable(value)).digest('hex'); }

function normalizeText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

function boundedTerms(value, limit = 20) {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(values.map((term) => normalizeText(term).toLowerCase()).filter(Boolean).map((term) => term.slice(0, 64)))].slice(0, limit);
}

function fitOptions(options = {}) {
  const fit = options.fit && typeof options.fit === 'object' && !Array.isArray(options.fit) ? options.fit : options;
  return {
    audienceKeywords: boundedTerms(fit.audienceKeywords ?? fit.audience ?? fit.audienceTerms),
    targetChannel: normalizeText(fit.targetChannel ?? fit.channelTarget ?? '').toLowerCase().slice(0, 80),
    targetLocale: normalizeText(fit.targetLocale ?? fit.locale ?? '').toLowerCase().slice(0, 32),
  };
}

function hasFitHints(options = {}) {
  const { audienceKeywords, targetChannel, targetLocale } = fitOptions(options);
  return audienceKeywords.length > 0 || Boolean(targetChannel) || Boolean(targetLocale);
}

export function evaluateDiscoveryFit(discovery, options = {}) {
  const { audienceKeywords, targetChannel, targetLocale } = fitOptions(options);
  const haystack = normalizeText(`${discovery?.title || ''} ${discovery?.text || ''}`).toLowerCase().slice(0, 20_000);
  const matchedTerms = audienceKeywords.filter((term) => haystack.includes(term));
  const audience = audienceKeywords.length === 0
    ? { status: 'UNKNOWN', matchedTerms: [], reason: 'no audience terms supplied' }
    : (matchedTerms.length
      ? { status: 'MATCHED', matchedTerms, reason: 'audience term matched normalized text' }
      : (haystack ? { status: 'MISMATCHED', matchedTerms: [], reason: 'no audience term matched normalized text' } : { status: 'UNKNOWN', matchedTerms: [], reason: 'no audience text evidence' }));

  const observedChannel = normalizeText(discovery?.channel || discovery?.policy?.host).toLowerCase();
  const channel = !targetChannel
    ? { status: 'UNKNOWN', reason: 'no target channel supplied' }
    : (!observedChannel ? { status: 'UNKNOWN', reason: 'no observed channel evidence' }
      : (observedChannel === targetChannel || observedChannel.includes(targetChannel) || targetChannel.includes(observedChannel)
        ? { status: 'MATCHED', reason: 'observed channel matched target' }
        : { status: 'MISMATCHED', reason: 'observed channel did not match target' }));

  const observedLocale = normalizeText(discovery?.locale || discovery?.localeHint || '').toLowerCase().slice(0, 32);
  const locale = !targetLocale
    ? { status: 'UNKNOWN', reason: 'no target locale supplied' }
    : (!observedLocale ? { status: 'UNKNOWN', reason: 'no observed locale evidence' }
      : (observedLocale === targetLocale ? { status: 'MATCHED', reason: 'observed locale matched target' } : { status: 'MISMATCHED', reason: 'observed locale did not match target' }));
  const statuses = [audience.status, channel.status, locale.status];
  const eligible = statuses.every((status) => status === 'MATCHED');
  return { audience, channel, locale, eligible, explanation: eligible ? 'all supplied fit evidence matched' : 'fit is advisory and not fully matched' };
}

function redactText(value) {
  return normalizeText(value).replace(SECRET_VALUE, 'credential/session material exists').replace(SECRET_ASSIGNMENT, '$1=credential/session material exists');
}

function normalizeTimestamp(value) {
  const text = redactText(value);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeUrl(raw) {
  const url = new URL(String(raw));
  if (!ALLOWED_SCHEMES.has(url.protocol) || UNSAFE_SCHEMES.test(String(raw)) || url.username || url.password) throw new Error('unsupported or unsafe URL');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

function policyFor(url, policies = {}) {
  const host = new URL(url).hostname;
  const entry = policies[host] ?? policies['*'];
  if (!entry) return { status: 'UNSUPPORTED', reason: 'no channel policy for host', host };
  if (entry.enabled === false) return { status: 'INELIGIBLE', reason: redactText(entry.reason || 'channel disabled'), host };
  if (Array.isArray(entry.allowedHosts) && !entry.allowedHosts.includes(host)) return { status: 'INELIGIBLE', reason: 'host not allowed by policy', host };
  return {
    status: 'ELIGIBLE', reason: 'channel policy matched', host,
    channel: redactText(entry.channel || host),
    actions: [...(entry.actions || [])].map((action) => redactText(action)).sort()
  };
}

export function normalizeDiscovery(observation, { policies = {}, now = new Date().toISOString() } = {}) {
  if (!observation || typeof observation !== 'object') throw new Error('observation must be an object');
  const url = normalizeUrl(observation.url);
  const policy = policyFor(url, policies);
  const title = redactText(observation.title);
  const text = redactText(observation.text ?? observation.body ?? observation.content);
  const provenance = {
    source: redactText(observation.source || 'caller-supplied'),
    observedAt: redactText(observation.observedAt || now),
    sourceId: observation.sourceId ? redactText(observation.sourceId) : undefined,
  };
  const contentHash = redactText(observation.contentHash, 128);
  const extractorRevision = redactText(observation.extractorRevision, 180);
  const sourceRefs = Array.isArray(observation.sourceRefs)
    ? [...new Set(observation.sourceRefs.map((ref) => redactText(ref, 300)).filter(Boolean))].slice(0, 16)
    : [];
  if (contentHash) provenance.contentHash = contentHash;
  if (extractorRevision) provenance.extractorRevision = extractorRevision;
  if (sourceRefs.length) provenance.sourceRefs = sourceRefs;
  if (observation.fetch && typeof observation.fetch === 'object' && !Array.isArray(observation.fetch)) {
    provenance.fetch = {
      backend: redactText(observation.fetch.backend, 40) || null,
      jobId: redactText(observation.fetch.jobId, 160) || null,
      contentHash: redactText(observation.fetch.contentHash, 128) || null,
      extractorRevision: redactText(observation.fetch.extractorRevision, 180) || null,
      coverage: observation.fetch.coverage && typeof observation.fetch.coverage === 'object' ? {
        html: observation.fetch.coverage.html === true,
        jsRendered: observation.fetch.coverage.jsRendered === true,
        markdown: observation.fetch.coverage.markdown === true,
        structured: observation.fetch.coverage.structured === true,
        post: observation.fetch.coverage.post === true,
        comment: observation.fetch.coverage.comment === true,
        network: observation.fetch.coverage.network === true
      } : null
    };
  }
  const publishedAt = normalizeTimestamp(observation.publishedAt);
  const normalized = {
    url,
    title,
    text,
    author: redactText(observation.author),
    channel: policy.channel || policy.host,
    policy,
    provenance,
    ...(observation.recordType ? { recordType: redactText(observation.recordType, 40) } : {}),
    ...(observation.parentRecordId ? { parentRecordId: redactText(observation.parentRecordId, 240) } : {}),
    ...(observation.untrusted === true ? { untrusted: true } : {})
  };
  const locale = redactText(observation.locale || observation.localeHint);
  if (locale) normalized.locale = locale;
  if (publishedAt) normalized.publishedAt = publishedAt;
  const discoveryId = hash({ url, title, text, author: normalized.author });
  return { ...normalized, discoveryId, normalizedAt: now, status: policy.status };
}

export function deduplicateDiscoveries(discoveries) {
  const seen = new Map();
  for (const item of discoveries || []) {
    if (!item?.discoveryId) continue;
    const prior = seen.get(item.discoveryId);
    if (!prior || String(item.provenance?.observedAt || '') < String(prior.provenance?.observedAt || '')) seen.set(item.discoveryId, item);
  }
  return [...seen.values()].sort((a, b) => a.discoveryId.localeCompare(b.discoveryId));
}

export function classifyDiscovery(discovery, { keywords = [], blockedKeywords = [] } = {}) {
  if (!discovery || discovery.status !== 'ELIGIBLE') return { label: 'INELIGIBLE', reason: discovery?.policy?.reason || 'not eligible', matchedKeywords: [] };
  const haystack = `${discovery.title} ${discovery.text}`.toLowerCase();
  const blocked = blockedKeywords.filter((word) => haystack.includes(String(word).toLowerCase()));
  if (blocked.length) return { label: 'BLOCKED', reason: 'blocked keyword matched', matchedKeywords: [], blockedKeywords: blocked };
  const matched = keywords.filter((word) => haystack.includes(String(word).toLowerCase()));
  return { label: matched.length ? 'RELEVANT' : 'UNCLASSIFIED', reason: matched.length ? 'relevance keyword matched' : 'no relevance evidence', matchedKeywords: matched };
}

export function scoreDiscovery(discovery, classification, { weights = {} } = {}) {
  const factors = {
    eligible: discovery?.status === 'ELIGIBLE' ? 1 : 0,
    relevant: classification?.label === 'RELEVANT' ? 1 : 0,
    blocked: classification?.label === 'BLOCKED' ? 1 : 0,
    provenance: discovery?.provenance?.source ? 1 : 0,
  };
  const appliedWeights = { eligible: 40, relevant: 40, blocked: -100, provenance: 20, ...weights };
  const score = Math.max(0, Math.min(100, Object.entries(factors).reduce((sum, [key, value]) => sum + value * appliedWeights[key], 0)));
  return { score, factors, weights: appliedWeights, explanation: Object.entries(factors).filter(([, value]) => value).map(([key]) => `${key}=${appliedWeights[key]}`).join(',') || 'no positive evidence' };
}

export function processDiscoveries(observations, options = {}) {
  const normalized = (observations || []).map((item) => normalizeDiscovery(item, options));
  return deduplicateDiscoveries(normalized).map((item) => {
    const classification = classifyDiscovery(item, options);
    const withFit = hasFitHints(options) ? { fit: evaluateDiscoveryFit(item, options) } : {};
    return { ...item, classification, score: scoreDiscovery(item, classification, options), ...withFit };
  });
}

export { stable };
