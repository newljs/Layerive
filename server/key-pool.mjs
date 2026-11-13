// Multi-key rotation with backoff.
//
// A model may carry several API keys for the same platform (`apiKeys`). Keys
// live only in config/models.json on this machine: the browser never receives
// a plaintext key except through the explicit reveal endpoint, and task
// snapshots strip them before they reach SQLite.
//
// Rotation policy:
//   * keys are tried in round-robin order, starting after the last used one;
//   * a key that answers 401/403 is parked for a long cooldown (bad credential);
//   * a key that answers 429 is parked for `Retry-After` (or a short backoff);
//   * a key that answers 5xx is parked briefly;
//   * a successful call clears that key's failure count and cooldown.
//
// Cooldowns live in process memory: a restart starts from a clean slate, which
// is the honest behaviour for a rate limiter we do not own.

const AUTH_COOLDOWN_MS = 5 * 60 * 1000;
const SERVER_COOLDOWN_MS = 15 * 1000;
const MAX_BACKOFF_MS = 60 * 1000;

/** Every distinct, non-empty key configured on a model, in declared order. */
const MASKED_KEY = '••••••••';

export function modelKeys(model) {
  const listed = Array.isArray(model?.apiKeys) ? model.apiKeys : [];
  // A masked entry means "unchanged, value withheld" — it is never a credential.
  const keys = listed.map((value) => String(value ?? '').trim()).filter((key) => key && key !== MASKED_KEY);
  if (!keys.length) {
    const single = String(model?.apiKey ?? '').trim();
    // The masked placeholder is a UI artefact, never a usable credential.
    if (single && single !== MASKED_KEY) keys.push(single);
  }
  return [...new Set(keys)];
}

export function keyCount(model) {
  return modelKeys(model).length;
}

// Keyed by model id plus the key itself, so two models sharing a key keep
// independent budgets and renaming a key never inherits a stale cooldown.
const pools = new Map();

function poolFor(model) {
  const id = String(model?.id || model?.model || 'model');
  if (!pools.has(id)) pools.set(id, { cursor: 0, keys: new Map() });
  return pools.get(id);
}

function keyState(pool, key) {
  if (!pool.keys.has(key)) pool.keys.set(key, { failures: 0, cooldownUntil: 0, lastUsedAt: 0, successCount: 0, failureCount: 0 });
  return pool.keys.get(key);
}

function backoffFor(failures) {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));
}

/**
 * Errors that mean "this credential is the problem, try another key".
 *
 * Deliberately excludes 5xx: a broken upstream fails every key the same way, so
 * rotating through the pool would burn each key's cooldown for nothing. Those
 * are retried as transient platform errors instead.
 */
export function isKeyRotationError(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403 || status === 429) return true;
  return /invalid.?api.?key|unauthorized|authentication|forbidden|rps exhausted|rate.?limit|too many requests|quota|insufficient/i
    .test(String(error?.message || ''));
}

/** Platform-side failures that justify a backoff on the same key. */
export function isTransientPlatformError(error) {
  const status = Number(error?.status);
  if (status >= 500 && status <= 599) return true;
  return /timeout|timed out|network|fetch failed|socket hang up|econnreset|econnrefused|etimedout|temporar|bad gateway/i
    .test(String(error?.message || ''));
}

/**
 * The next usable key for a model, honouring cooldowns.
 * Returns `{ key, index, waitedMs }`, or `null` when every key is parked and
 * `wait` was false.
 */
export function acquireKey(model, { exclude = [], wait = false, now = Date.now() } = {}) {
  const keys = modelKeys(model);
  if (!keys.length) return null;
  const pool = poolFor(model);
  // Accept any iterable so callers can pass a Set or a plain array.
  const skip = exclude instanceof Set ? exclude : new Set(exclude);
  const candidates = keys.map((key, index) => ({ key, index })).filter((item) => !skip.has(item.key));
  if (!candidates.length) return null;
  const ordered = [...candidates.slice(pool.cursor % candidates.length), ...candidates.slice(0, pool.cursor % candidates.length)];
  let earliest = Infinity;
  for (const item of ordered) {
    const state = keyState(pool, item.key);
    if (state.cooldownUntil <= now) {
      pool.cursor = (item.index + 1) % keys.length;
      return { key: item.key, index: item.index, waitedMs: 0 };
    }
    earliest = Math.min(earliest, state.cooldownUntil);
  }
  if (!wait || !Number.isFinite(earliest)) return null;
  return { key: null, index: -1, waitedMs: Math.max(1, earliest - now), keys };
}

export function markKeySuccess(model, key) {
  if (!key) return;
  const pool = poolFor(model);
  const state = keyState(pool, key);
  state.failures = 0;
  state.cooldownUntil = 0;
  state.lastUsedAt = Date.now();
  state.successCount += 1;
}

export function markKeyFailure(model, key, error) {
  if (!key) return 0;
  const pool = poolFor(model);
  const state = keyState(pool, key);
  state.failures += 1;
  state.failureCount += 1;
  state.lastUsedAt = Date.now();
  const status = Number(error?.status);
  const requested = Number(error?.retryAfterMs) || 0;
  const cooldown = status === 401 || status === 403
    ? AUTH_COOLDOWN_MS
    : status === 429
      ? (requested > 0 ? Math.min(MAX_BACKOFF_MS, requested) : backoffFor(state.failures))
      : status >= 500
        ? Math.max(SERVER_COOLDOWN_MS, requested > 0 ? Math.min(MAX_BACKOFF_MS, requested) : 0)
        : backoffFor(state.failures);
  state.cooldownUntil = Date.now() + cooldown;
  return cooldown;
}

/** Per-key health for the settings page and the MCP status tool. Never returns the key itself. */
export function keyPoolStatus(model, now = Date.now()) {
  const keys = modelKeys(model);
  const pool = poolFor(model);
  return keys.map((key, index) => {
    const state = keyState(pool, key);
    return {
      index,
      // A stable, non-reversible-enough fingerprint for telling keys apart in a UI.
      label: `${key.slice(0, 4)}…${key.slice(-4)}`,
      failures: state.failures,
      successCount: state.successCount,
      failureCount: state.failureCount,
      cooling: state.cooldownUntil > now,
      cooldownMs: Math.max(0, state.cooldownUntil - now),
      lastUsedAt: state.lastUsedAt ? new Date(state.lastUsedAt).toISOString() : null,
    };
  });
}

/** Test hook: forget every recorded cooldown. */
export function resetKeyPool() {
  pools.clear();
}

/**
 * Run `attempt(modelWithOneKey)` under the key pool.
 *
 * The callback receives a copy of the model whose `apiKey` is the key selected
 * for this try, so provider code never has to know the pool exists. Rotation
 * stops as soon as a key succeeds; credential and rate-limit failures park that
 * key and move on to the next one. Other failures propagate untouched — a bad
 * prompt or an unsupported size must not drain the whole pool.
 *
 * `delay` is injected so the caller can supply the abortable sleep it already
 * uses, and `signal` lets a cancelled task stop waiting for a cooldown.
 */
export async function withKeyPool(model, { attempt, delay, signal, log = null } = {}) {
  const keys = modelKeys(model);
  // A single credential has nothing to rotate to: running it through the pool
  // would only park it on a transient 429 and multiply the caller's own retry
  // budget. Pass straight through and keep the previous behaviour.
  if (keys.length < 2) return attempt(model);
  const maxTries = Math.max(2, keys.length * 2);
  const tried = new Set();
  let lastError = null;
  for (let round = 0; round < maxTries; round += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    // After the first full sweep, retry keys that have had time to cool down.
    if (round >= keys.length) tried.clear();
    let acquired = acquireKey(model, { exclude: tried });
    if (!acquired) {
      const parked = acquireKey(model, { wait: true });
      const waitedMs = Number(parked?.waitedMs) || 0;
      if (!waitedMs) break;
      if (log) log(`全部 ${keys.length} 个 API Key 均在冷却，等待 ${Math.round(waitedMs / 100) / 10} 秒后重试`);
      await delay(Math.min(waitedMs, MAX_BACKOFF_MS), signal);
      tried.clear();
      acquired = acquireKey(model, { exclude: tried });
      if (!acquired) break;
    }
    tried.add(acquired.key);
    const keyed = { ...model, apiKey: acquired.key, apiKeys: keys };
    try {
      const result = await attempt(keyed);
      markKeySuccess(model, acquired.key);
      return result;
    } catch (error) {
      lastError = error;
      if (!isKeyRotationError(error) || signal?.aborted) throw error;
      const cooldownMs = markKeyFailure(model, acquired.key, error);
      if (log) log(`API Key #${acquired.index + 1} 失败（${Number(error?.status) || 'network'}），冷却 ${Math.round(cooldownMs / 100) / 10} 秒后换下一个`);
    }
  }
  throw lastError || Object.assign(new Error('所有 API Key 均不可用，请稍后重试'), { status: 429, code: 'model.allKeysUnavailable' });
}
