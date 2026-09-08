// ============================================================================
// Automation Notifications Manager Card
// ----------------------------------------------------------------------------
// A Home Assistant custom Dashboard card that discovers EVERY notify.* action
// embedded in your automations, groups them by automation, and lets you browse,
// filter, and fully edit each notification (target, title, message, and nested
// platform options) — writing changes back to the automation via HA's REST
// config API.
//
// Author: LTek
// Version: v2026.09.08.1
//
// Design system: follows unified-cards/CARD_DESIGN_SYSTEM.md — the --ltek-*
// editor token block (byte-identical across cards), panel/row idioms,
// render-once + throttled updateStates, byte-stable sparse config,
// editMode/preview safety.
// ============================================================================

const BUILD_NUMBER = 'v2026.09.08.1';

let DEBUG = false;
function debugLog(...args) { if (DEBUG) { try { console.log('[ANM]', ...args); } catch (e) {} } }

// ============================================================================
// PURE HELPERS (copied byte-for-byte from the shipped cards for parity)
// ============================================================================

function uid() {
  return 'anm_' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a Date as a short relative time string, e.g. "30 mins ago".
function formatRelativeTime(date) {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

// Normalize a HA websocket / REST error into a readable string (from CLM).
function formatWsError(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message && err.code) return `${err.message} (code: ${err.code})`;
  if (err.message) return err.message;
  if (err.code) return `code: ${err.code}`;
  try { return JSON.stringify(err); } catch (e) { return String(err); }
}

// YAML preview helpers (from EES). Used only for the editor's read-only preview.
function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return "''";
  if (
    /[:#&*!|>'"%@`{}\[\],]/.test(s) ||
    /^[\s\-?]/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|null|yes|no|on|off)$/i.test(s) ||
    /^[\d.+-]/.test(s)
  ) {
    return "'" + s.replace(/'/g, "''") + "'";
  }
  return s;
}
function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + '[]';
    return value
      .map(item => {
        if (item !== null && typeof item === 'object') {
          const inner = toYaml(item, indent + 1);
          const lines = inner.split('\n');
          const first = lines[0].replace(/^\s+/, '');
          const rest = lines.slice(1).join('\n');
          return pad + '- ' + first + (rest ? '\n' + rest : '');
        }
        return pad + '- ' + yamlScalar(item);
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return pad + '{}';
    return keys
      .map(k => {
        const v = value[k];
        if (v !== null && typeof v === 'object') {
          if (
            (Array.isArray(v) && v.length === 0) ||
            (!Array.isArray(v) && Object.keys(v).length === 0)
          ) {
            return pad + k + ': ' + (Array.isArray(v) ? '[]' : '{}');
          }
          return pad + k + ':\n' + toYaml(v, indent + 1);
        }
        return pad + k + ': ' + yamlScalar(v);
      })
      .join('\n');
  }
  return pad + yamlScalar(value);
}

// Deep clone that tolerates plain JSON-ish data (automation configs are).
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Escape a string for safe use inside a CSS attribute selector (rowIds/paths
// contain quotes, colons, brackets). Prefer the native CSS.escape when present.
function cssEscape(s) {
  s = String(s);
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\\]\[:.]/g, '\\$&');
}

// ============================================================================
// NOTIFY DISCOVERY ENGINE
// ----------------------------------------------------------------------------
// A notify call can be nested arbitrarily deep in an automation's action tree
// (inside choose/if-then-else/repeat/parallel/sequence). We WALK the tree to
// discover every notify call and record its exact PATH (array of keys/indices),
// so on save we can navigate a fresh deep-clone of the config to that path and
// mutate ONLY that node — never reformatting or losing unrelated branches.
// ============================================================================

// The columns the table can show, in canonical order. "automation" is normally
// carried by the group header, but kept as a togglable column for a flat view.
const ALL_COLUMNS = ['automation', 'target', 'title', 'message', 'last_triggered', 'enabled'];
const DEFAULT_COLUMNS = ['automation', 'target', 'title', 'message'];

// A node is a notify call when it carries a service-ish key whose string value
// starts with "notify." — covers classic `service:`, modern `action:`, the
// `notify.notify`/`notify.send_message` forms, and legacy `notify.<device>`.
function notifyServiceKey(node) {
  if (!isPlainObject(node)) return null;
  if (typeof node.service === 'string' && node.service.indexOf('notify.') === 0) return 'service';
  if (typeof node.action === 'string' && node.action.indexOf('notify.') === 0) return 'action';
  return null;
}
function isNotifyCall(node) {
  return notifyServiceKey(node) !== null;
}

// Recursively discover notify calls. `path` is the array of keys/indices from
// the automation config root to `node`. Pushes { path, node } for each hit.
// Recurses by EXACT control-flow key so recorded paths are surgically accurate.
function walkNotifyActions(node, path, out) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkNotifyActions(node[i], path.concat(i), out);
    }
    return;
  }
  if (!isPlainObject(node)) return;

  if (isNotifyCall(node)) {
    out.push({ path: path.slice(), node });
    // Do not return — a notify call won't itself nest actions, but keep walking
    // defensively so we never miss an unusual embedded sequence.
  }

  // choose: [ { conditions:[...], sequence:[...] }, ... ] + default: [...]
  if (Array.isArray(node.choose)) {
    for (let c = 0; c < node.choose.length; c++) {
      const branch = node.choose[c];
      if (branch && branch.sequence !== undefined) {
        walkNotifyActions(branch.sequence, path.concat('choose', c, 'sequence'), out);
      }
    }
  }
  if (node.default !== undefined) walkNotifyActions(node.default, path.concat('default'), out);
  // if / then / else
  if (node.then !== undefined) walkNotifyActions(node.then, path.concat('then'), out);
  if (node.else !== undefined) walkNotifyActions(node.else, path.concat('else'), out);
  // repeat: { count|while|until|for_each, sequence:[...] }
  if (isPlainObject(node.repeat) && node.repeat.sequence !== undefined) {
    walkNotifyActions(node.repeat.sequence, path.concat('repeat', 'sequence'), out);
  }
  // sequence (grouped actions)
  if (node.sequence !== undefined) walkNotifyActions(node.sequence, path.concat('sequence'), out);
  // parallel: array of action lists
  if (Array.isArray(node.parallel)) walkNotifyActions(node.parallel, path.concat('parallel'), out);
}

// Navigate an object by a path array (string props or numeric indices).
function getAtPath(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    if (cur == null) return undefined;
    cur = cur[path[i]];
  }
  return cur;
}

// Normalize the many notify call-shapes into a common editable view.
//   service = node.service || node.action (full "notify.X")
//   target  = node.target || null (structured target; legacy encodes it in the
//             service name itself so target stays null there)
//   title   = node.data?.title ?? ''
//   message = node.data?.message ?? ''
//   data    = deep clone of node.data?.data ?? {} (platform-specific options)
function extractNotifyFields(node) {
  const key = notifyServiceKey(node);
  const service = (key && node[key]) || '';
  const data = isPlainObject(node.data) ? node.data : {};
  return {
    callShape: node.service !== undefined ? 'service' : (node.action !== undefined ? 'action' : 'service'),
    service: service,
    target: (node.target !== undefined && node.target !== null) ? deepClone(node.target) : null,
    title: (data.title !== undefined && data.title !== null) ? String(data.title) : '',
    message: (data.message !== undefined && data.message !== null) ? String(data.message) : '',
    data: isPlainObject(data.data) ? deepClone(data.data) : {}
  };
}

// Write edited fields back into a notify node IN PLACE, preserving its original
// shape and every sibling key. Deletes keys that become empty (byte-stable).
// `fields` = { service, target, title, message, data } from the row draft.
function applyNotifyFields(node, fields) {
  // Service string → back into whichever key the node used (service vs action).
  const key = (node.action !== undefined && node.service === undefined) ? 'action' : 'service';
  if (fields.service != null && fields.service !== '') {
    node[key] = fields.service;
  }

  // Structured target — set when non-empty, delete when cleared.
  if (fields.target && isPlainObject(fields.target) && Object.keys(fields.target).length) {
    node.target = deepClone(fields.target);
  } else if (node.target !== undefined && (fields.target === null || (isPlainObject(fields.target) && !Object.keys(fields.target).length))) {
    delete node.target;
  }

  // title / message / data.data live under node.data. Build/prune it minimally.
  let data = isPlainObject(node.data) ? node.data : null;
  const ensureData = () => { if (!data) { data = {}; node.data = data; } return data; };

  const setOrDelete = (obj, k, val) => {
    if (val != null && val !== '') obj[k] = val;
    else if (obj && obj[k] !== undefined) delete obj[k];
  };

  if (data || (fields.title != null && fields.title !== '') || (fields.message != null && fields.message !== '')) {
    ensureData();
    setOrDelete(data, 'title', fields.title);
    setOrDelete(data, 'message', fields.message);
  }

  // Nested platform options (data.data).
  const hasNested = fields.data && isPlainObject(fields.data) && Object.keys(fields.data).length;
  if (hasNested) {
    ensureData();
    data.data = deepClone(fields.data);
  } else if (data && data.data !== undefined) {
    delete data.data;
  }

  // If data ended up empty, drop it entirely (byte-stable).
  if (node.data && isPlainObject(node.data) && !Object.keys(node.data).length) {
    delete node.data;
  }
  return node;
}

// The automation's editable config id (null ⇒ YAML/package, read-only).
function automationConfigId(hass, entityId) {
  const st = hass && hass.states ? hass.states[entityId] : null;
  return (st && st.attributes && st.attributes.id) || null;
}

// ============================================================================
// AUTOMATION CONFIG CACHE (module-level, per session)
// ----------------------------------------------------------------------------
// Fetching every automation's config is 1 REST call each (config/automation/
// config/<id>). We cache by config id, fetch lazily on group-expand + a
// concurrency-limited background prefetch, and mark YAML/package automations
// read-only when the fetch errors.
// ============================================================================

const AUTO_CFG_CACHE = { byId: {} };   // id -> { status, config, error, fetchedAt }

function _cacheEntry(id) {
  if (!AUTO_CFG_CACHE.byId[id]) AUTO_CFG_CACHE.byId[id] = { status: 'idle', config: null, error: null, fetchedAt: 0 };
  return AUTO_CFG_CACHE.byId[id];
}

// Fetch one automation config. Resolves the cache entry; calls onChange after.
function ensureAutomationConfig(hass, id, onChange, force) {
  const e = _cacheEntry(id);
  if (!force && (e.status === 'loading' || e.status === 'loaded' || e.status === 'readonly')) return;
  if (!hass || typeof hass.callApi !== 'function') {
    e.status = 'error'; e.error = 'hass.callApi unavailable';
    if (onChange) { try { onChange(id); } catch (x) {} }
    return;
  }
  e.status = 'loading'; e.error = null;
  hass.callApi('GET', `config/automation/config/${id}`)
    .then(cfg => {
      e.status = 'loaded'; e.config = cfg; e.fetchedAt = Date.now();
      if (onChange) { try { onChange(id); } catch (x) {} }
    })
    .catch(err => {
      // A 404/error here means the automation isn't editable via storage (YAML
      // or packages) — mirror CLM's read-only scene handling.
      e.status = 'readonly'; e.error = formatWsError(err); e.fetchedAt = Date.now();
      if (onChange) { try { onChange(id); } catch (x) {} }
    });
}

// Background prefetch all ids in concurrency-limited waves so the target filter
// can populate without blocking the first render.
function ensureAllAutomationConfigs(hass, ids, onChange, limit) {
  const queue = ids.filter(id => {
    const e = _cacheEntry(id);
    return e.status === 'idle';
  });
  let active = 0;
  const max = limit || 5;
  const pump = () => {
    while (active < max && queue.length) {
      const id = queue.shift();
      const e = _cacheEntry(id);
      if (e.status !== 'idle') continue;
      active++;
      e.status = 'loading'; e.error = null;
      hass.callApi('GET', `config/automation/config/${id}`)
        .then(cfg => { e.status = 'loaded'; e.config = cfg; e.fetchedAt = Date.now(); })
        .catch(err => { e.status = 'readonly'; e.error = formatWsError(err); e.fetchedAt = Date.now(); })
        .then(() => { active--; if (onChange) { try { onChange(id); } catch (x) {} } pump(); });
    }
  };
  if (hass && typeof hass.callApi === 'function') pump();
}

// ============================================================================
// CONFIG (view prefs only — sparse + byte-stable)
// ----------------------------------------------------------------------------
// The card's own config holds ONLY view preferences. Notify data lives in the
// automations (fetched via REST), never here; edits/dirtiness are transient
// runtime state, never serialized. normalizeConfig is idempotent and drops
// every key equal to its default so a fresh card and a re-saved card emit
// identical (near-empty) YAML.
// ============================================================================

const DEFAULT_FILTERS = { target: '', automation: '', state: 'any', has_title: false, editable_only: false };

function stubConfig() {
  return {
    type: 'custom:automation-notifications-manager-card',
    title: '',
    columns: DEFAULT_COLUMNS.slice(),
    filters: { ...DEFAULT_FILTERS },
    live_render: false,
    groups_default_open: true,
    open_groups: [],
    min_refresh_seconds: 0
  };
}

// A columns array equals the default when it is the same SET (order-insensitive).
function sameColumnSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const sa = a.slice().sort().join(',');
  const sb = b.slice().sort().join(',');
  return sa === sb;
}

function normalizeFilters(f) {
  f = isPlainObject(f) ? f : {};
  return {
    target: typeof f.target === 'string' ? f.target : '',
    automation: typeof f.automation === 'string' ? f.automation : '',
    state: (f.state === 'on' || f.state === 'off') ? f.state : 'any',
    has_title: !!f.has_title,
    editable_only: !!f.editable_only
  };
}
function filtersAreDefault(f) {
  return f.target === '' && f.automation === '' && f.state === 'any' && !f.has_title && !f.editable_only;
}

// Full normalized config used at RUNTIME (all keys present, defaults filled).
function normalizeConfigFull(config) {
  const stub = stubConfig();
  const cols = Array.isArray(config.columns) && config.columns.length
    ? config.columns.filter(c => ALL_COLUMNS.includes(c))
    : stub.columns;
  return {
    ...stub,
    ...config,
    title: typeof config.title === 'string' ? config.title : '',
    columns: cols.length ? cols : stub.columns,
    filters: normalizeFilters(config.filters),
    live_render: !!config.live_render,
    groups_default_open: config.groups_default_open !== false,
    open_groups: Array.isArray(config.open_groups) ? config.open_groups.filter(x => typeof x === 'string') : [],
    min_refresh_seconds: Math.max(0, Number(config.min_refresh_seconds) || 0)
  };
}

// SPARSE normalized config used for EMISSION (byte-stable): drop every key equal
// to its default. Idempotent — normalizing twice yields the same object.
function normalizeConfig(config) {
  const full = normalizeConfigFull(config || {});
  const out = { type: full.type || 'custom:automation-notifications-manager-card' };
  if (full.title && full.title.trim()) out.title = full.title;
  if (!sameColumnSet(full.columns, DEFAULT_COLUMNS)) {
    // Emit in canonical order for stability.
    out.columns = ALL_COLUMNS.filter(c => full.columns.includes(c));
  }
  if (!filtersAreDefault(full.filters)) {
    const f = {};
    if (full.filters.target) f.target = full.filters.target;
    if (full.filters.automation) f.automation = full.filters.automation;
    if (full.filters.state !== 'any') f.state = full.filters.state;
    if (full.filters.has_title) f.has_title = true;
    if (full.filters.editable_only) f.editable_only = true;
    out.filters = f;
  }
  if (full.live_render) out.live_render = true;
  if (full.groups_default_open === false) out.groups_default_open = false;
  if (full.open_groups.length) out.open_groups = full.open_groups.slice();
  if (full.min_refresh_seconds > 0) out.min_refresh_seconds = full.min_refresh_seconds;
  return out;
}

// ============================================================================
// RENDERER — ANMCard
// ============================================================================

class ANMCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._rendered = false;
    this._updateTimer = null;
    this._lastRefreshAt = 0;
    this._rows = [];                 // discovered notification rows (runtime only)
    this._edit = false;              // dashboard edit mode
    this._prev = false;              // preview
    this._editMode = false;
    // Runtime view state (card-face filters/columns; seeded from config, not persisted).
    this._viewFilters = null;
    this._viewColumns = null;
    this._liveRender = false;
    this._openState = {};            // automation config id -> bool (open/closed override)
    // Live-render subscriptions: cellKey -> { promise, unsub, template }
    this._tpl = { subs: new Map(), enabled: false };
  }

  disconnectedCallback() {
    if (this._updateTimer) { clearTimeout(this._updateTimer); this._updateTimer = null; }
    this._teardownAllTpl();
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = normalizeConfigFull(config);
    DEBUG = !!config.debug;
    // Seed runtime view state from config defaults.
    this._viewFilters = { ...this._config.filters };
    this._viewColumns = this._config.columns.slice();
    this._liveRender = !!this._config.live_render;
    if (this._hass) { this._rendered = false; this.renderCard(); this._rendered = true; }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._rendered) {
      this.renderCard();
      this._rendered = true;
      return;
    }
    // Throttle: coalesce hass bursts into one updateStates() (250ms trailing
    // debounce, raised by min_refresh_seconds), single in-flight timer guard.
    if (this._updateTimer) return;
    const minMs = Math.max(0, Number(this._config.min_refresh_seconds) || 0) * 1000;
    const now = Date.now();
    const sinceLast = now - (this._lastRefreshAt || 0);
    const delay = minMs > 0 ? Math.max(250, minMs - sinceLast) : 250;
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this._lastRefreshAt = Date.now();
      try { this.updateStates(); } catch (e) { debugLog('updateStates error', e); }
    }, delay);
  }
  get hass() { return this._hass; }

  // HA sets these on the hui-card wrapper. No hiding feature here, so they just
  // mirror into flags and never trigger a full re-render.
  set editMode(v) { this._edit = !!v; this._editMode = this._edit || this._prev; }
  get editMode() { return this._edit === true; }
  set preview(v) { this._prev = !!v; this._editMode = this._edit || this._prev; }
  get preview() { return this._prev === true; }

  getCardSize() {
    const groups = this._groupCount || 3;
    return Math.min(20, groups * 2 + 2);
  }

  static getConfigElement() {
    return document.createElement('automation-notifications-manager-card-editor');
  }
  static getStubConfig() { return { type: 'custom:automation-notifications-manager-card' }; }

  // ------------------------------------------------------------------------
  // DISCOVERY — build the row model from hass automations + cached configs.
  // ------------------------------------------------------------------------
  _automationEntities() {
    const hass = this._hass;
    if (!hass || !hass.states) return [];
    return Object.keys(hass.states).filter(id => id.indexOf('automation.') === 0).sort();
  }

  // Rebuild this._rows from every automation whose config is loaded. Automations
  // still loading contribute a placeholder group; ones with no notify calls or
  // that are read-only still appear (read-only shows locked rows if loaded).
  _buildRows() {
    const hass = this._hass;
    const rows = [];
    const groups = [];   // ordered { autoEntityId, autoConfigId, autoName, editable, status, rows:[] }
    const ents = this._automationEntities();
    ents.forEach(entityId => {
      const st = hass.states[entityId];
      const cfgId = automationConfigId(hass, entityId);
      const name = (st.attributes && st.attributes.friendly_name) || entityId;
      const g = {
        autoEntityId: entityId,
        autoConfigId: cfgId,
        autoName: name,
        autoState: st.state,
        autoLastTriggered: st.attributes && st.attributes.last_triggered,
        editable: false,
        status: cfgId ? _cacheEntry(cfgId).status : 'readonly',
        error: cfgId ? _cacheEntry(cfgId).error : 'No editable config id (YAML/packages).',
        rows: []
      };
      if (cfgId) {
        const entry = _cacheEntry(cfgId);
        if (entry.status === 'loaded' && entry.config) {
          const cfg = entry.config;
          const actions = cfg.action !== undefined ? cfg.action : cfg.actions;
          const actionKey = cfg.action !== undefined ? 'action' : (cfg.actions !== undefined ? 'actions' : 'action');
          const hits = [];
          if (actions !== undefined) walkNotifyActions(actions, [actionKey], hits);
          g.editable = true;
          hits.forEach(h => {
            const f = extractNotifyFields(h.node);
            const pathKey = JSON.stringify(h.path);
            const rowId = `${cfgId}::${pathKey}`;
            const prior = this._rowById(rowId);   // preserve edit/dirty across rebuilds
            rows.push({
              rowId,
              autoEntityId: entityId,
              autoConfigId: cfgId,
              autoName: name,
              autoState: st.state,
              autoLastTriggered: g.autoLastTriggered,
              editable: true,
              path: h.path,
              callShape: f.callShape,
              service: f.service,
              target: f.target,
              title: f.title,
              message: f.message,
              data: f.data,
              _dirty: prior ? prior._dirty : false,
              _edit: prior ? prior._edit : false,
              _draft: prior ? prior._draft : null
            });
            g.rows.push(rowId);
          });
        }
      }
      // Only include groups that have notify rows, are loading, or errored with
      // a config id (so the user sees why). Skip plain automations with none.
      if (g.rows.length || g.status === 'loading' || (cfgId && g.status === 'idle')) {
        groups.push(g);
      } else if (g.editable && !g.rows.length) {
        // loaded but zero notify calls → omit (no notifications to manage)
      } else if (!cfgId) {
        // YAML automation: we can't read its actions at all, so we can't know if
        // it has notifications. Omit to avoid a wall of unknowable locked groups.
      }
    });
    this._rows = rows;
    this._groups = groups;
    this._groupCount = groups.length;
    return { rows, groups };
  }

  _rowById(rowId) { return (this._rows || []).find(r => r.rowId === rowId) || null; }
  _groupById(cfgId) { return (this._groups || []).find(g => g.autoConfigId === cfgId) || null; }

  // ------------------------------------------------------------------------
  // FILTERS — a row's group is shown when the automation matches the filters.
  // Filtering by a target shows only automations CONTAINING that target, but
  // still shows ALL notify rows nested in the matching automations.
  // ------------------------------------------------------------------------
  _filteredGroups() {
    const f = this._viewFilters || DEFAULT_FILTERS;
    const groups = this._groups || [];
    return groups.filter(g => {
      // editable-only
      if (f.editable_only && !g.editable) return false;
      // automation name/id substring
      if (f.automation) {
        const hay = (g.autoName + ' ' + g.autoEntityId).toLowerCase();
        if (hay.indexOf(f.automation.toLowerCase()) === -1) return false;
      }
      // state
      if (f.state === 'on' && g.autoState !== 'on') return false;
      if (f.state === 'off' && g.autoState !== 'off') return false;
      // target / has_title operate on the group's rows — group passes if ANY
      // nested row matches (then we show ALL its rows, per the spec).
      const grows = g.rows.map(id => this._rowById(id)).filter(Boolean);
      if (f.target) {
        const t = f.target.toLowerCase();
        const anyTarget = grows.some(r => {
          const svc = (r.service || '').toLowerCase();
          const tgt = r.target ? JSON.stringify(r.target).toLowerCase() : '';
          return svc.indexOf(t) !== -1 || tgt.indexOf(t) !== -1;
        });
        if (!anyTarget && grows.length) return false;
      }
      if (f.has_title) {
        const anyTitle = grows.some(r => r.title && r.title.trim());
        if (!anyTitle && grows.length) return false;
      }
      return true;
    });
  }

  // Union of every discovered notify service, for the target-filter dropdown.
  _allTargets() {
    const set = new Set();
    (this._rows || []).forEach(r => { if (r.service) set.add(r.service); });
    return Array.from(set).sort();
  }

  _isOpen(cfgId) {
    if (Object.prototype.hasOwnProperty.call(this._openState, cfgId)) return this._openState[cfgId];
    const cfg = this._config || {};
    const inList = Array.isArray(cfg.open_groups) && cfg.open_groups.includes(cfgId);
    // open_groups is an OVERRIDE list against groups_default_open.
    return cfg.groups_default_open ? !inList : inList;
  }

  // ------------------------------------------------------------------------
  // RENDER (full DOM build — once)
  // ------------------------------------------------------------------------
  renderCard() {
    if (!this._hass || !this._config) return;
    const { groups } = this._buildRows();

    // Kick off loading: enumerate ids, lazy-load open groups + background prefetch.
    const ids = this._automationEntities().map(e => automationConfigId(this._hass, e)).filter(Boolean);
    // Prefetch in the background so the target filter + groups populate.
    ensureAllAutomationConfigs(this._hass, ids, (id) => this._onConfigLoaded(id), 5);

    const cols = this._viewColumns || DEFAULT_COLUMNS;
    const filtered = this._filteredGroups();
    const loadingCount = ids.filter(id => { const e = _cacheEntry(id); return e.status === 'loading' || e.status === 'idle'; }).length;

    this.innerHTML = `
      <ha-card class="anm-wrap">
        <style>${this._styles()}</style>
        ${this._config.title ? `<div class="anm-header">${escapeHtml(this._config.title)}</div>` : ''}
        ${this._renderToolbar(loadingCount, ids.length)}
        <div class="anm-groups" data-cols="${cols.join(' ')}">
          ${filtered.length
            ? filtered.map(g => this._renderGroup(g)).join('')
            : `<div class="anm-empty">No matching automations with notifications.</div>`}
        </div>
      </ha-card>
    `;
    this._applyColumnVisibility();
    this._attachHandlers();
    if (this._liveRender) this._enableLiveRender();
  }

  _renderToolbar(loadingCount, total) {
    const f = this._viewFilters || DEFAULT_FILTERS;
    const targets = this._allTargets();
    const cols = this._viewColumns || DEFAULT_COLUMNS;
    const loadNote = loadingCount > 0 ? `<span class="anm-load">Loading ${total - loadingCount}/${total}…</span>` : '';
    return `
      <div class="anm-toolbar">
        <div class="anm-filters">
          <input class="anm-f-name" type="text" placeholder="Filter automations…" value="${escapeHtml(f.automation)}">
          <select class="anm-f-target">
            <option value="">All targets</option>
            ${targets.map(t => `<option value="${escapeHtml(t)}"${t === f.target ? ' selected' : ''}>${escapeHtml(t.replace('notify.', ''))}</option>`).join('')}
          </select>
          <select class="anm-f-state">
            <option value="any"${f.state === 'any' ? ' selected' : ''}>Any state</option>
            <option value="on"${f.state === 'on' ? ' selected' : ''}>On</option>
            <option value="off"${f.state === 'off' ? ' selected' : ''}>Off</option>
          </select>
          <label class="anm-chk"><input type="checkbox" class="anm-f-hastitle"${f.has_title ? ' checked' : ''}> Has title</label>
          <label class="anm-chk"><input type="checkbox" class="anm-f-editable"${f.editable_only ? ' checked' : ''}> Editable only</label>
        </div>
        <div class="anm-toolbar-right">
          <label class="anm-chk anm-live-toggle"><input type="checkbox" class="anm-live"${this._liveRender ? ' checked' : ''}> Live render</label>
          <details class="anm-colmenu">
            <summary>Columns</summary>
            <div class="anm-colmenu-body">
              ${ALL_COLUMNS.map(c => `<label class="anm-chk"><input type="checkbox" class="anm-col" data-col="${c}"${cols.includes(c) ? ' checked' : ''}> ${this._colLabel(c)}</label>`).join('')}
            </div>
          </details>
          <button class="anm-refresh" title="Reload automation configs">↻</button>
          ${loadNote}
        </div>
      </div>
    `;
  }

  _colLabel(c) {
    return { automation: 'Automation', target: 'Target', title: 'Title', message: 'Message', last_triggered: 'Last triggered', enabled: 'Enabled' }[c] || c;
  }

  _renderGroup(g) {
    const open = this._isOpen(g.autoConfigId || g.autoEntityId);
    const grows = g.rows.map(id => this._rowById(id)).filter(Boolean);
    const lock = !g.editable ? `<span class="anm-lock" title="${escapeHtml(g.error || 'Read-only')}">🔒</span>` : '';
    const stateDot = `<span class="anm-state anm-state-${g.autoState === 'on' ? 'on' : 'off'}" title="${escapeHtml(g.autoState)}"></span>`;
    let body;
    if (g.status === 'loading' || g.status === 'idle') {
      body = `<div class="anm-skeleton">Loading automation config…</div>`;
    } else if (!g.editable) {
      body = `<div class="anm-readonly-note">Defined in YAML/packages — read-only here.${g.error ? ' (' + escapeHtml(g.error) + ')' : ''}</div>`;
    } else if (!grows.length) {
      body = `<div class="anm-readonly-note">No notify actions.</div>`;
    } else {
      body = `
        <table class="anm-table">
          <thead><tr>
            <th data-col="target">Target</th>
            <th data-col="title">Title</th>
            <th data-col="message">Message</th>
            <th class="anm-actions-h"></th>
          </tr></thead>
          <tbody>
            ${grows.map(r => this._renderRow(r, g)).join('')}
          </tbody>
        </table>`;
    }
    return `
      <details class="anm-group" data-group-id="${escapeHtml(g.autoConfigId || g.autoEntityId)}"${open ? ' open' : ''}>
        <summary class="anm-group-sum">
          <ha-icon icon="mdi:robot" class="anm-group-icon"></ha-icon>
          ${stateDot}
          <span class="anm-group-name">${escapeHtml(g.autoName)}</span>
          ${lock}
          <span class="anm-group-count">${g.rows.length ? g.rows.length + ' notif' + (g.rows.length === 1 ? '' : 's') : ''}</span>
          <span class="anm-group-lt" data-lt-for="${escapeHtml(g.autoEntityId)}" data-col="last_triggered">${g.autoLastTriggered ? formatRelativeTime(new Date(g.autoLastTriggered)) : ''}</span>
        </summary>
        <div class="anm-group-body">${body}</div>
      </details>`;
  }

  _renderRow(r, g) {
    const editing = r._edit;
    const draft = r._draft || r;
    const dirty = r._dirty ? ' anm-dirty' : '';
    const svcShort = (r.service || '').replace('notify.', '');
    const targetChip = r.target ? `<span class="anm-tchip" title="${escapeHtml(JSON.stringify(r.target))}">target</span>` : '';
    const rawTitle = escapeHtml(draft.title || '');
    const rawMsg = escapeHtml(draft.message || '');
    const hasTpl = (s) => typeof s === 'string' && s.indexOf('{{') !== -1;

    if (!editing) {
      return `
        <tr class="anm-row${dirty}" data-row-id="${escapeHtml(r.rowId)}">
          <td data-col="target"><span class="anm-svc">${escapeHtml(svcShort)}</span>${targetChip}</td>
          <td data-col="title"><span class="anm-cell-tpl" data-tpl-cell="${escapeHtml(r.rowId)}::title" data-tpl="${rawTitle}">${rawTitle || '<span class="anm-none">—</span>'}</span></td>
          <td data-col="message"><span class="anm-cell-tpl" data-tpl-cell="${escapeHtml(r.rowId)}::message" data-tpl="${rawMsg}">${rawMsg || '<span class="anm-none">—</span>'}</span></td>
          <td class="anm-actions">
            <button class="anm-btn-edit" data-row-id="${escapeHtml(r.rowId)}" title="Edit">✎</button>
          </td>
        </tr>`;
    }
    // Editing: inline inputs seeded from the draft.
    const dataJson = escapeHtml(JSON.stringify(draft.data || {}, null, 2));
    return `
      <tr class="anm-row anm-editing${dirty}" data-row-id="${escapeHtml(r.rowId)}">
        <td colspan="4" class="anm-editcell">
          <div class="anm-edit-grid">
            <label>Target service</label>
            <input class="anm-in" data-field="service" type="text" value="${escapeHtml(draft.service || '')}">
            <label>Title</label>
            <input class="anm-in" data-field="title" type="text" value="${escapeHtml(draft.title || '')}">
            <label>Message</label>
            <textarea class="anm-in anm-in-msg" data-field="message" rows="3">${escapeHtml(draft.message || '')}</textarea>
            <label>Options (data.data JSON)</label>
            <textarea class="anm-in anm-in-json" data-field="data" rows="4">${dataJson}</textarea>
          </div>
          <div class="anm-edit-actions">
            ${r._dirty ? `<button class="anm-btn-save" data-row-id="${escapeHtml(r.rowId)}">Save</button>` : ''}
            <button class="anm-btn-cancel" data-row-id="${escapeHtml(r.rowId)}">Cancel</button>
          </div>
        </td>
      </tr>`;
  }

  _styles() {
    return `
      .anm-wrap { padding: 8px 10px 12px; }
      .anm-header { font-size: 18px; font-weight: 700; color: var(--primary-text-color,#e1e1e1); padding: 6px 4px 10px; }
      .anm-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; padding: 4px 2px 10px; border-bottom: 1px solid var(--divider-color,#333); margin-bottom: 8px; }
      .anm-filters, .anm-toolbar-right { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .anm-toolbar input[type=text], .anm-toolbar select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); font-size: 12px; }
      .anm-f-name { min-width: 160px; }
      .anm-chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--secondary-text-color,#aaa); cursor: pointer; }
      .anm-load { font-size: 11px; color: var(--secondary-text-color,#888); }
      .anm-refresh { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#ccc); border-radius: 6px; cursor: pointer; padding: 4px 8px; font-size: 14px; }
      .anm-colmenu { position: relative; }
      .anm-colmenu > summary { list-style: none; cursor: pointer; font-size: 12px; padding: 6px 10px; border: 1px solid var(--divider-color,#444); border-radius: 6px; color: var(--primary-text-color,#ccc); }
      .anm-colmenu > summary::-webkit-details-marker { display: none; }
      .anm-colmenu-body { position: absolute; right: 0; top: 110%; z-index: 5; background: var(--card-background-color,#1c1c1c); border: 1px solid var(--divider-color,#444); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }
      .anm-groups { display: flex; flex-direction: column; gap: 8px; }
      .anm-empty, .anm-skeleton, .anm-readonly-note { color: var(--secondary-text-color,#888); font-size: 13px; padding: 10px; }
      .anm-group { border: 1px solid var(--divider-color,#3a3a3a); border-radius: 12px; background: rgba(255,255,255,0.015); overflow: hidden; }
      .anm-group[open] { border-color: var(--primary-color,#2196F3); }
      .anm-group-sum { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 14px; }
      .anm-group-sum::-webkit-details-marker { display: none; }
      .anm-group-icon { color: var(--primary-color,#2196F3); --mdc-icon-size: 20px; }
      .anm-group-name { font-weight: 500; color: var(--primary-text-color,#e1e1e1); flex: 0 1 auto; }
      .anm-group-count { color: var(--secondary-text-color,#888); font-size: 11px; }
      .anm-group-lt { margin-left: auto; color: var(--secondary-text-color,#888); font-size: 11px; }
      .anm-state { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .anm-state-on { background: var(--success-color,#4caf50); }
      .anm-state-off { background: var(--disabled-text-color,#666); }
      .anm-lock { font-size: 12px; }
      .anm-group-body { padding: 0 8px 8px; }
      .anm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .anm-table th { text-align: left; color: var(--secondary-text-color,#888); font-weight: 600; font-size: 11px; padding: 4px 8px; border-bottom: 1px solid var(--divider-color,#333); }
      .anm-table td { padding: 6px 8px; vertical-align: top; border-bottom: 1px solid var(--divider-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); }
      .anm-row:hover td { background: rgba(255,255,255,0.02); }
      .anm-row.anm-dirty td { background: rgba(var(--rgb-primary-color,33,150,243),0.10); }
      .anm-svc { font-family: var(--code-font-family,monospace); }
      .anm-tchip { margin-left: 6px; font-size: 10px; padding: 1px 5px; border-radius: 999px; border: 1px solid var(--divider-color,#444); color: var(--secondary-text-color,#aaa); }
      .anm-cell-tpl { white-space: pre-wrap; word-break: break-word; }
      .anm-none { color: var(--secondary-text-color,#666); }
      .anm-tpl-pending { opacity: 0.6; }
      .anm-tpl-err { color: var(--error-color,#f44336); }
      .anm-actions, .anm-actions-h { width: 36px; text-align: right; }
      .anm-btn-edit { background: transparent; border: none; color: var(--secondary-text-color,#aaa); cursor: pointer; font-size: 14px; padding: 2px 4px; }
      .anm-btn-edit:hover { color: var(--primary-text-color,#fff); }
      .anm-editcell { background: rgba(var(--rgb-primary-color,33,150,243),0.06); }
      .anm-edit-grid { display: grid; grid-template-columns: 120px 1fr; gap: 8px 10px; align-items: center; padding: 6px 2px; }
      .anm-edit-grid label { font-size: 12px; color: var(--secondary-text-color,#aaa); }
      .anm-in { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); font-size: 12px; }
      .anm-in-msg, .anm-in-json { font-family: var(--code-font-family,monospace); resize: vertical; }
      .anm-edit-actions { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 2px 4px; }
      .anm-btn-save { background: var(--primary-color,#2196F3); color: #fff; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
      .anm-btn-cancel { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#e1e1e1); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
    `;
  }

  // Hide columns not in the visible set via generated attribute rules. Cheap
  // enough to re-run on toggle without a row-DOM rebuild.
  _applyColumnVisibility() {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) return;
    const cols = this._viewColumns || DEFAULT_COLUMNS;
    wrap.setAttribute('data-cols', cols.join(' '));
    let styleEl = this.querySelector('#anm-col-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'anm-col-style';
      this.appendChild(styleEl);
    }
    const hidden = ALL_COLUMNS.filter(c => !cols.includes(c));
    styleEl.textContent = hidden.map(c => `.anm-groups [data-col="${c}"]{display:none;}`).join('');
  }

  // ------------------------------------------------------------------------
  // EVENT WIRING (delegated where possible)
  // ------------------------------------------------------------------------
  _attachHandlers() {
    const root = this;
    // Filters
    const nameEl = root.querySelector('.anm-f-name');
    if (nameEl) nameEl.addEventListener('input', () => { this._viewFilters.automation = nameEl.value; this._reflowGroups(); });
    const tgtEl = root.querySelector('.anm-f-target');
    if (tgtEl) tgtEl.addEventListener('change', () => { this._viewFilters.target = tgtEl.value; this._reflowGroups(); });
    const stEl = root.querySelector('.anm-f-state');
    if (stEl) stEl.addEventListener('change', () => { this._viewFilters.state = stEl.value; this._reflowGroups(); });
    const htEl = root.querySelector('.anm-f-hastitle');
    if (htEl) htEl.addEventListener('change', () => { this._viewFilters.has_title = htEl.checked; this._reflowGroups(); });
    const edEl = root.querySelector('.anm-f-editable');
    if (edEl) edEl.addEventListener('change', () => { this._viewFilters.editable_only = edEl.checked; this._reflowGroups(); });
    // Live-render toggle
    const liveEl = root.querySelector('.anm-live');
    if (liveEl) liveEl.addEventListener('change', () => {
      this._liveRender = liveEl.checked;
      if (this._liveRender) this._enableLiveRender(); else this._disableLiveRender();
    });
    // Column toggles
    root.querySelectorAll('.anm-col').forEach(cb => cb.addEventListener('change', () => {
      const c = cb.getAttribute('data-col');
      const set = new Set(this._viewColumns);
      if (cb.checked) set.add(c); else set.delete(c);
      this._viewColumns = ALL_COLUMNS.filter(x => set.has(x));
      this._applyColumnVisibility();
    }));
    // Refresh
    const refEl = root.querySelector('.anm-refresh');
    if (refEl) refEl.addEventListener('click', () => this._refreshAll());
    // Group open/close persistence
    root.querySelectorAll('.anm-group').forEach(d => {
      d.addEventListener('toggle', () => {
        const id = d.getAttribute('data-group-id');
        this._openState[id] = d.open;
        // Lazy-load config the first time a group opens (if not yet loaded).
        if (d.open) {
          const g = this._groupById(id);
          if (g && g.autoConfigId) {
            const e = _cacheEntry(g.autoConfigId);
            if (e.status === 'idle') ensureAutomationConfig(this._hass, g.autoConfigId, (cid) => this._onConfigLoaded(cid));
          }
        }
      });
    });
    // Edit / Save / Cancel (delegated)
    root.querySelectorAll('.anm-btn-edit').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onEdit(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-cancel').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onCancel(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-save').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onSave(b.getAttribute('data-row-id')); }));
    // Edit-field inputs → mark dirty + update draft
    root.querySelectorAll('.anm-row.anm-editing').forEach(tr => {
      const rowId = tr.getAttribute('data-row-id');
      tr.querySelectorAll('.anm-in').forEach(inp => {
        inp.addEventListener('input', () => this._onFieldInput(rowId, inp));
      });
    });
  }

  // Re-render only the groups container (filters changed). Keeps toolbar state.
  _reflowGroups() {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) { this._rendered = false; this.renderCard(); this._rendered = true; return; }
    const filtered = this._filteredGroups();
    wrap.innerHTML = filtered.length
      ? filtered.map(g => this._renderGroup(g)).join('')
      : `<div class="anm-empty">No matching automations with notifications.</div>`;
    this._applyColumnVisibility();
    // Reattach only the group/row handlers (toolbar handlers are still bound).
    this._attachGroupHandlers();
    if (this._liveRender) this._enableLiveRender();
  }

  _attachGroupHandlers() {
    const root = this;
    root.querySelectorAll('.anm-group').forEach(d => {
      d.addEventListener('toggle', () => {
        const id = d.getAttribute('data-group-id');
        this._openState[id] = d.open;
        if (d.open) {
          const g = this._groupById(id);
          if (g && g.autoConfigId) { const e = _cacheEntry(g.autoConfigId); if (e.status === 'idle') ensureAutomationConfig(this._hass, g.autoConfigId, (cid) => this._onConfigLoaded(cid)); }
        }
      });
    });
    root.querySelectorAll('.anm-btn-edit').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onEdit(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-cancel').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onCancel(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-save').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onSave(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-row.anm-editing').forEach(tr => {
      const rowId = tr.getAttribute('data-row-id');
      tr.querySelectorAll('.anm-in').forEach(inp => inp.addEventListener('input', () => this._onFieldInput(rowId, inp)));
    });
  }

  _onConfigLoaded(/* cfgId */) {
    // A background/lazy config fetch resolved — rebuild rows and reflow if we're
    // rendered. Avoid clobbering in-progress edits (preserved via _rowById).
    if (!this._rendered) return;
    this._buildRows();
    this._reflowGroups();
    this._refreshToolbarTargets();
  }

  _refreshToolbarTargets() {
    const sel = this.querySelector('.anm-f-target');
    if (!sel) return;
    const cur = this._viewFilters.target;
    const targets = this._allTargets();
    sel.innerHTML = `<option value="">All targets</option>` +
      targets.map(t => `<option value="${escapeHtml(t)}"${t === cur ? ' selected' : ''}>${escapeHtml(t.replace('notify.', ''))}</option>`).join('');
  }

  _refreshAll() {
    const ids = this._automationEntities().map(e => automationConfigId(this._hass, e)).filter(Boolean);
    ids.forEach(id => ensureAutomationConfig(this._hass, id, (cid) => this._onConfigLoaded(cid), true));
  }

  // ------------------------------------------------------------------------
  // EDIT / DIRTY / SAVE
  // ------------------------------------------------------------------------
  _onEdit(rowId) {
    const r = this._rowById(rowId);
    if (!r || !r.editable) return;
    r._edit = true;
    // Seed the draft from the current fields (deep clone so edits are isolated).
    r._draft = { service: r.service, target: deepClone(r.target), title: r.title, message: r.message, data: deepClone(r.data) };
    // While editing, drop the live-render sub for this row's cells (show raw).
    this._unsubscribeCell(`${rowId}::title`);
    this._unsubscribeCell(`${rowId}::message`);
    this._reflowGroups();
  }

  _onCancel(rowId) {
    const r = this._rowById(rowId);
    if (!r) return;
    r._edit = false; r._dirty = false; r._draft = null;
    this._reflowGroups();
  }

  _onFieldInput(rowId, inp) {
    const r = this._rowById(rowId);
    if (!r || !r._draft) return;
    const field = inp.getAttribute('data-field');
    if (field === 'data') {
      // JSON textarea — parse leniently; mark the field invalid but still dirty.
      const raw = inp.value.trim();
      if (raw === '' || raw === '{}') { r._draft.data = {}; inp.classList.remove('anm-in-invalid'); }
      else {
        try { r._draft.data = JSON.parse(raw); inp.classList.remove('anm-in-invalid'); }
        catch (e) { inp.classList.add('anm-in-invalid'); }
      }
    } else {
      r._draft[field] = inp.value;
    }
    if (!r._dirty) {
      r._dirty = true;
      // Reveal the Save button + dirty tint without a full reflow (targeted).
      const tr = this.querySelector(`.anm-row.anm-editing[data-row-id="${cssEscape(rowId)}"]`);
      if (tr) {
        tr.classList.add('anm-dirty');
        const actions = tr.querySelector('.anm-edit-actions');
        if (actions && !actions.querySelector('.anm-btn-save')) {
          const btn = document.createElement('button');
          btn.className = 'anm-btn-save';
          btn.setAttribute('data-row-id', rowId);
          btn.textContent = 'Save';
          btn.addEventListener('click', (e) => { e.stopPropagation(); this._onSave(rowId); });
          actions.insertBefore(btn, actions.firstChild);
        }
      }
    }
  }

  async _onSave(rowId) {
    const r = this._rowById(rowId);
    if (!r || !r._draft) return;
    const hass = this._hass;
    if (!hass || typeof hass.callApi !== 'function') { this._toast('Cannot save: hass.callApi unavailable.', true); return; }

    // Mandatory confirmation.
    const confirmed = await this._confirmModal({
      title: 'Save notification change?',
      body: `This rewrites automation "<b>${escapeHtml(r.autoName)}</b>" and reloads automations. A live automation may re-trigger. Continue?`,
      confirmLabel: 'Save & reload',
      danger: true
    });
    if (!confirmed) return;

    try {
      // Re-fetch fresh config right before write (never trust the cache).
      const fresh = await hass.callApi('GET', `config/automation/config/${r.autoConfigId}`);
      const clone = deepClone(fresh);

      // Coalesce ALL dirty rows for this same automation into one write.
      const dirtyRows = this._rows.filter(x => x.autoConfigId === r.autoConfigId && x._dirty && x._draft);
      for (const dr of dirtyRows) {
        const node = getAtPath(clone, dr.path);
        if (!node || !isNotifyCall(node)) {
          this._toast('Automation changed elsewhere — reloading.', true);
          ensureAutomationConfig(hass, r.autoConfigId, (cid) => this._onConfigLoaded(cid), true);
          return;
        }
        applyNotifyFields(node, dr._draft);
      }

      await hass.callApi('POST', `config/automation/config/${r.autoConfigId}`, clone);
      await hass.callService('automation', 'reload').catch(() => {});

      // Update cache + clear dirty/edit state on the written rows.
      const entry = _cacheEntry(r.autoConfigId);
      entry.status = 'loaded'; entry.config = clone; entry.fetchedAt = Date.now();
      dirtyRows.forEach(dr => { dr._dirty = false; dr._edit = false; dr._draft = null; });
      this._buildRows();
      this._reflowGroups();
      this._toast('Saved ✓', false);
    } catch (err) {
      this._toast('Save failed: ' + formatWsError(err), true);
    }
  }

  // ------------------------------------------------------------------------
  // MODAL (native <dialog> in the top layer, above HA's editor dialog).
  // ------------------------------------------------------------------------
  _showModal(contentEl) {
    const dlg = document.createElement('dialog');
    dlg.style.cssText = 'padding:0;border:none;background:transparent;max-width:none;max-height:none;';
    const st = document.createElement('style');
    st.textContent = 'dialog::backdrop{background:rgba(0,0,0,0.55);}';
    dlg.appendChild(st);
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--ha-card-background,var(--card-background-color,#1c1c1c));color:var(--primary-text-color,#e1e1e1);border:1px solid var(--divider-color,#444);border-radius:12px;max-width:520px;width:min(520px,92vw);max-height:85vh;overflow:auto;padding:18px;box-sizing:border-box;box-shadow:0 8px 40px rgba(0,0,0,0.5);';
    box.appendChild(contentEl);
    dlg.appendChild(box);
    const close = () => { try { dlg.close(); } catch (e) {} if (dlg.parentNode) dlg.parentNode.removeChild(dlg); };
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    return { close, box };
  }

  _confirmModal({ title, body, confirmLabel, danger }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      const accent = danger ? 'var(--error-color,#f44336)' : 'var(--primary-color,#2196F3)';
      wrap.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${title}</div>
        <div style="font-size:13px;color:var(--secondary-text-color,#bbb);line-height:1.5;margin-bottom:16px;">${body}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="anm-m-cancel" style="padding:8px 14px;border:1px solid var(--divider-color,#444);border-radius:6px;background:transparent;color:var(--primary-text-color,#e1e1e1);cursor:pointer;font-size:13px;">Cancel</button>
          <button class="anm-m-ok" style="padding:8px 16px;border:none;border-radius:6px;background:${accent};color:#fff;cursor:pointer;font-size:13px;">${escapeHtml(confirmLabel || 'Confirm')}</button>
        </div>`;
      const modal = this._showModal(wrap);
      wrap.querySelector('.anm-m-cancel').onclick = () => { modal.close(); resolve(false); };
      wrap.querySelector('.anm-m-ok').onclick = () => { modal.close(); resolve(true); };
    });
  }

  _toast(msg, isError) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:8px;font-size:13px;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.4);background:${isError ? 'var(--error-color,#f44336)' : 'var(--success-color,#4caf50)'};`;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, isError ? 4500 : 2000);
  }

  // ------------------------------------------------------------------------
  // LIVE RENDER — per-cell render_template WS subscriptions (new mechanism).
  // ------------------------------------------------------------------------
  _enableLiveRender() {
    this._tpl.enabled = true;
    const hass = this._hass;
    if (!hass || !hass.connection || typeof hass.connection.subscribeMessage !== 'function') return;
    // Subscribe only VISIBLE template cells whose text contains {{ }}.
    this.querySelectorAll('.anm-cell-tpl[data-tpl-cell]').forEach(el => {
      const key = el.getAttribute('data-tpl-cell');
      const tpl = el.getAttribute('data-tpl') || '';
      if (tpl.indexOf('{{') === -1) return;   // static text — nothing to render
      this._subscribeCell(key, tpl, el);
    });
  }

  _subscribeCell(key, tpl, el) {
    const existing = this._tpl.subs.get(key);
    if (existing) {
      if (existing.template === tpl) return;   // already live on the same template
      this._unsubscribeCell(key);
    }
    const hass = this._hass;
    if (!hass || !hass.connection) return;
    el.classList.add('anm-tpl-pending');
    const rec = { promise: null, unsub: null, template: tpl };
    this._tpl.subs.set(key, rec);
    rec.promise = hass.connection.subscribeMessage(
      (msg) => {
        if (msg && msg.error) { el.textContent = '⚠ ' + msg.error; el.classList.remove('anm-tpl-pending'); el.classList.add('anm-tpl-err'); return; }
        el.textContent = (msg && msg.result != null) ? String(msg.result) : '';
        el.classList.remove('anm-tpl-pending', 'anm-tpl-err');
      },
      { type: 'render_template', template: tpl, report_errors: true }
    );
    rec.promise.then(u => {
      const cur = this._tpl.subs.get(key);
      if (cur === rec) rec.unsub = u; else { try { u(); } catch (e) {} }   // torn down before resolve
    }).catch(err => {
      el.textContent = '⚠ ' + formatWsError(err); el.classList.remove('anm-tpl-pending'); el.classList.add('anm-tpl-err');
    });
  }

  _unsubscribeCell(key) {
    const rec = this._tpl.subs.get(key);
    if (!rec) return;
    this._tpl.subs.delete(key);
    if (rec.unsub) { try { rec.unsub(); } catch (e) {} }
    else if (rec.promise) { rec.promise.then(u => { try { u(); } catch (e) {} }).catch(() => {}); }
    // Repaint raw text from the cell's data-tpl.
    const el = this.querySelector(`.anm-cell-tpl[data-tpl-cell="${cssEscape(key)}"]`);
    if (el) { el.textContent = el.getAttribute('data-tpl') || ''; el.classList.remove('anm-tpl-pending', 'anm-tpl-err'); }
  }

  _disableLiveRender() {
    this._tpl.enabled = false;
    Array.from(this._tpl.subs.keys()).forEach(k => this._unsubscribeCell(k));
  }

  _teardownAllTpl() {
    Array.from(this._tpl.subs.keys()).forEach(k => this._unsubscribeCell(k));
    this._tpl.enabled = false;
  }

  // ------------------------------------------------------------------------
  // LIVE PATCH — refresh last_triggered / enabled / filter visibility without
  // a full re-render. Never re-fetch configs; never clobber in-progress edits.
  // ------------------------------------------------------------------------
  updateStates() {
    const hass = this._hass;
    if (!hass || !this._rendered) return;
    // Refresh per-group live values.
    (this._groups || []).forEach(g => {
      const st = hass.states[g.autoEntityId];
      if (!st) return;
      g.autoState = st.state;
      g.autoLastTriggered = st.attributes && st.attributes.last_triggered;
      const ltEl = this.querySelector(`.anm-group-lt[data-lt-for="${cssEscape(g.autoEntityId)}"]`);
      if (ltEl) ltEl.textContent = g.autoLastTriggered ? formatRelativeTime(new Date(g.autoLastTriggered)) : '';
      const sumEl = this.querySelector(`.anm-group[data-group-id="${cssEscape(g.autoConfigId || g.autoEntityId)}"] .anm-state`);
      if (sumEl) { sumEl.className = 'anm-state anm-state-' + (g.autoState === 'on' ? 'on' : 'off'); }
    });
    // Re-apply filter visibility only if state/name filters could change the set.
    const f = this._viewFilters || DEFAULT_FILTERS;
    if (f.state !== 'any') {
      // A group's state may have flipped — reflow, but skip if any row is being edited.
      const editing = (this._rows || []).some(r => r._edit || r._dirty);
      if (!editing) this._reflowGroups();
    }
  }
}

// ============================================================================
// EDITOR — ANMCardEditor
// ============================================================================

class ANMCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._rendered = false;
    this._lastKnownJSON = null;
  }

  setConfig(config) {
    const normalized = normalizeConfig(config || {});
    const json = JSON.stringify(normalized);
    if (this._lastKnownJSON === json) { this._config = normalizeConfigFull(config || {}); return; }
    this._config = normalizeConfigFull(config || {});
    this._rendered = false;
    this.renderEditor();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && !this._rendered) this.renderEditor();
  }

  _fireConfigChanged() {
    let normalized;
    try { normalized = normalizeConfig(this._config); }
    catch (e) { normalized = this._config; }
    this._lastKnownJSON = JSON.stringify(normalized);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: JSON.parse(JSON.stringify(normalized)) },
      bubbles: true,
      composed: true
    }));
  }

  renderEditor() {
    if (!this._config) return;
    const c = this._config;
    this.innerHTML = `
      <div class="anm-ed">
        <style>${this._edStyles()}</style>

        <details class="anm-ed-row" open>
          <label>Card</label>
          <div class="anm-ed-hint">Title shown at the top of the card. Leave blank for none.</div>
          <div class="anm-ed-field">
            <input id="ed-title" type="text" placeholder="Automation Notifications" value="${escapeHtml(c.title || '')}">
          </div>
        </details>

        <details class="anm-ed-row">
          <label>Columns</label>
          <div class="anm-ed-hint">Which columns show by default. Users can still toggle these on the card.</div>
          ${ALL_COLUMNS.map(col => `
            <label class="anm-ed-check">
              <input type="checkbox" class="ed-col" data-col="${col}"${c.columns.includes(col) ? ' checked' : ''}>
              ${this._colLabel(col)}
            </label>`).join('')}
        </details>

        <details class="anm-ed-row">
          <label>Default filters</label>
          <div class="anm-ed-hint">Starting view filters. Filtering by a target shows only automations that use it — still with all their nested notifications.</div>
          <div class="anm-ed-field"><span>Automation name contains</span><input id="ed-f-name" type="text" value="${escapeHtml(c.filters.automation || '')}"></div>
          <div class="anm-ed-field"><span>Target contains</span><input id="ed-f-target" type="text" value="${escapeHtml(c.filters.target || '')}"></div>
          <div class="anm-ed-field"><span>State</span>
            <select id="ed-f-state">
              <option value="any"${c.filters.state === 'any' ? ' selected' : ''}>Any</option>
              <option value="on"${c.filters.state === 'on' ? ' selected' : ''}>On</option>
              <option value="off"${c.filters.state === 'off' ? ' selected' : ''}>Off</option>
            </select>
          </div>
          <label class="anm-ed-check"><input type="checkbox" id="ed-f-hastitle"${c.filters.has_title ? ' checked' : ''}> Only notifications with a title</label>
          <label class="anm-ed-check"><input type="checkbox" id="ed-f-editable"${c.filters.editable_only ? ' checked' : ''}> Only editable (storage-mode) automations</label>
        </details>

        <details class="anm-ed-row">
          <label>Behavior</label>
          <label class="anm-ed-check"><input type="checkbox" id="ed-live"${c.live_render ? ' checked' : ''}> Live-render templates by default</label>
          <label class="anm-ed-check"><input type="checkbox" id="ed-groups-open"${c.groups_default_open ? ' checked' : ''}> Automation groups open by default</label>
          <div class="anm-ed-slider-row">
            <span>Min refresh (s)</span>
            <input id="ed-min-refresh" type="range" min="0" max="60" step="1" value="${Number(c.min_refresh_seconds) || 0}">
            <span class="anm-ed-slider-value" id="ed-min-refresh-val">${Number(c.min_refresh_seconds) || 0}</span>
          </div>
        </details>

        <details class="anm-ed-row">
          <label>YAML preview</label>
          <div class="anm-ed-hint">Read-only. The card stores only view preferences — notifications live in your automations.</div>
          <pre class="anm-ed-yaml">${escapeHtml(toYaml(normalizeConfig(this._config)))}</pre>
        </details>
      </div>
    `;
    this._rendered = true;
    this._attachEditorHandlers();
  }

  _colLabel(c) {
    return { automation: 'Automation', target: 'Target', title: 'Title', message: 'Message', last_triggered: 'Last triggered', enabled: 'Enabled' }[c] || c;
  }

  _attachEditorHandlers() {
    const root = this;
    const set = (fn) => { fn(); this._fireConfigChanged(); this._refreshYaml(); };

    const titleEl = root.querySelector('#ed-title');
    if (titleEl) titleEl.addEventListener('input', () => set(() => { this._config.title = titleEl.value; }));

    root.querySelectorAll('.ed-col').forEach(cb => cb.addEventListener('change', () => set(() => {
      const col = cb.getAttribute('data-col');
      const s = new Set(this._config.columns);
      if (cb.checked) s.add(col); else s.delete(col);
      this._config.columns = ALL_COLUMNS.filter(x => s.has(x));
      if (!this._config.columns.length) this._config.columns = DEFAULT_COLUMNS.slice();
    })));

    const bind = (sel, apply) => { const el = root.querySelector(sel); if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => set(() => apply(el))); };
    bind('#ed-f-name', el => this._config.filters.automation = el.value);
    bind('#ed-f-target', el => this._config.filters.target = el.value);
    bind('#ed-f-state', el => this._config.filters.state = el.value);
    bind('#ed-f-hastitle', el => this._config.filters.has_title = el.checked);
    bind('#ed-f-editable', el => this._config.filters.editable_only = el.checked);
    bind('#ed-live', el => this._config.live_render = el.checked);
    bind('#ed-groups-open', el => this._config.groups_default_open = el.checked);

    const mr = root.querySelector('#ed-min-refresh');
    const mrVal = root.querySelector('#ed-min-refresh-val');
    if (mr) mr.addEventListener('input', () => set(() => { this._config.min_refresh_seconds = Number(mr.value) || 0; if (mrVal) mrVal.textContent = mr.value; }));
  }

  _refreshYaml() {
    const pre = this.querySelector('.anm-ed-yaml');
    if (pre) pre.textContent = toYaml(normalizeConfig(this._config));
  }

  _edStyles() {
    return `
        /* ============================================================
           DESIGN TOKENS — single source of truth for the whole editor.
           Change a value here and every control that uses the token
           updates in one place. Seeded at the pre-refactor values so
           this is visually identical; tune from here going forward.
           (Mirror this block in the Color card for cross-card parity.)
           ============================================================ */
        .anm-ed {
          /* Font sizes (by role, not by pixel) */
          --ltek-fs-panel-title: 16px;  /* top-level panel / section title */
          --ltek-fs-header: 15px;       /* editor header, panel summary */
          --ltek-fs-group: 14px;        /* group heading inside a panel */
          --ltek-fs-label: 13px;        /* standard field label / row */
          --ltek-fs-body: 12px;         /* body text, most controls */
          --ltek-fs-small: 11px;        /* hints, secondary text */
          --ltek-fs-tiny: 10px;         /* badges, micro-labels */
          /* Font weights */
          --ltek-fw-normal: 400;        /* control labels (recede) */
          --ltek-fw-medium: 500;
          --ltek-fw-semibold: 600;
          --ltek-fw-bold: 700;          /* titles, values (lead) */
          /* Text colors */
          --ltek-c-text: var(--primary-text-color, #e1e1e1);  /* primary */
          --ltek-c-label: #ccc;         /* control labels */
          --ltek-c-muted: #888;         /* hints / disabled */
          --ltek-c-accent: var(--primary-color, #2196F3);
          /* Accent tints — hover / active fills (kept as rgba literals; one place
             to change). Default to the Material blue the cards shipped with. */
          --ltek-c-accent-fade: rgba(var(--rgb-primary-color,33,150,243),0.12);       /* active / pressed fill */
          --ltek-c-accent-fade-soft: rgba(var(--rgb-primary-color,33,150,243),0.08);  /* hover fill */
          --ltek-c-error-fade: rgba(244,67,54,0.15);         /* delete hover fill */
          /* Status colors — defer to the user's theme, fall back to Material. */
          --ltek-c-error: var(--error-color, #f44336);
          --ltek-c-success: var(--success-color, #4caf50);
          --ltek-c-warning: var(--warning-color, #ffb300);
          --ltek-c-info: var(--info-color, #2196F3);
          /* Second accent: the green "library / shared" grouping (distinct from
             the blue layout accent on purpose — NOT tied to --primary-color). */
          --ltek-c-accent-lib: #7fd18a;
          --ltek-c-on-accent: #fff;   /* text/icon on a solid accent fill */
          /* Action icons (edit/copy/hide/etc): neutral idle → brighten on hover.
             Delete stays a status color (error) on its own hover. */
          --ltek-c-icon: #aaa;        /* idle action icon */
          --ltek-c-icon-hover: #fff;  /* hovered action icon */
          /* Surfaces */
          --ltek-c-surface: rgba(255,255,255,0.015);        /* panels */
          --ltek-c-surface-raised: rgba(255,255,255,0.02);  /* cards / rows */
          /* Borders */
          --ltek-c-panel-border: #3a3a3a;   /* panels */
          --ltek-c-border: #444;            /* controls */
          --ltek-c-border-soft: #333;       /* subtle inner dividers */
          /* Radii */
          --ltek-r-panel: 12px;   /* panels */
          --ltek-r-card: 10px;    /* section cards */
          --ltek-r-md: 8px;       /* blocks */
          --ltek-r-ctrl: 6px;     /* inputs, selects, buttons */
          /* Spacing scale (4px base) */
          --ltek-sp-1: 4px;
          --ltek-sp-2: 6px;
          --ltek-sp-3: 8px;
          --ltek-sp-4: 10px;
          --ltek-sp-5: 12px;
          --ltek-sp-6: 16px;
          /* Control padding — uniform input/select/button height. */
          --ltek-ctrl-pad: 6px 10px;
          /* Icon sizes (two clear roles; one-off glyphs stay literal). */
          --ltek-icon-sm: 16px;   /* inline / action icons */
          --ltek-icon-lg: 20px;   /* panel-title icons */
          /* Slider row geometry (shared by every slider) */
          --ltek-slider-val-w: 44px;   /* value readout column width */
          display: flex; flex-direction: column; gap: 8px; padding: 8px 0;
        }

        /* ---- Layout primitives (ANM-specific, built on the tokens) ---- */
        .anm-ed-row {
          display: flex; flex-direction: column; gap: var(--ltek-sp-4);
          border: 1px solid var(--ltek-c-panel-border);
          border-radius: var(--ltek-r-panel);
          padding: var(--ltek-sp-6);
          background: var(--ltek-c-surface);
        }
        details.anm-ed-row[open] { border-color: var(--ltek-c-accent); }
        .anm-ed-row > label:first-child {
          font-size: var(--ltek-fs-panel-title);
          font-weight: var(--ltek-fw-bold);
          color: var(--ltek-c-text);
          cursor: pointer;
        }
        .anm-ed-hint { font-size: var(--ltek-fs-small); color: var(--ltek-c-muted); line-height: 1.45; }
        .anm-ed-field { display: flex; align-items: center; gap: var(--ltek-sp-3); flex-wrap: wrap; }
        .anm-ed-field > span { font-size: var(--ltek-fs-label); color: var(--ltek-c-label); min-width: 150px; }
        .anm-ed-field input[type=text], .anm-ed-field select, .anm-ed input[type=text], .anm-ed select {
          flex: 1 1 180px; padding: var(--ltek-ctrl-pad);
          border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl);
          background: var(--secondary-background-color, #2a2a2a); color: var(--ltek-c-text);
          font-size: var(--ltek-fs-body);
        }
        .anm-ed-check { display: flex; align-items: center; gap: var(--ltek-sp-2); font-size: var(--ltek-fs-label); color: var(--ltek-c-label); cursor: pointer; }
        .anm-ed-slider-row { display: flex; align-items: center; gap: var(--ltek-sp-3); }
        .anm-ed-slider-row > span:first-child { font-size: var(--ltek-fs-label); color: var(--ltek-c-label); min-width: 150px; }
        .anm-ed-slider-row input[type=range] { flex: 1; }
        .anm-ed-slider-value { width: var(--ltek-slider-val-w); text-align: right; font-variant-numeric: tabular-nums; font-size: var(--ltek-fs-body); color: var(--ltek-c-text); }
        .anm-ed-yaml { margin: 0; padding: var(--ltek-sp-4); background: var(--secondary-background-color, #2a2a2a); border-radius: var(--ltek-r-md); font-family: var(--code-font-family, monospace); font-size: var(--ltek-fs-small); color: var(--ltek-c-text); white-space: pre-wrap; overflow-x: auto; }
    `;
  }
}

// ============================================================================
// REGISTER CUSTOM ELEMENTS
// ============================================================================
console.log(`📦 Registering automation-notifications-manager-card custom elements... [${BUILD_NUMBER}]`);
customElements.define('automation-notifications-manager-card', ANMCard);
customElements.define('automation-notifications-manager-card-editor', ANMCardEditor);
console.log('[automation-notifications-manager-card] Loaded successfully -', BUILD_NUMBER);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'automation-notifications-manager-card',
  name: 'Automation Notifications Manager Card',
  description: 'Browse and edit every notify action embedded in your automations, grouped by automation.',
});





