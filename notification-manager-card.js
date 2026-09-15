// ============================================================================
// Notification Manager Card
// ----------------------------------------------------------------------------
// A Home Assistant custom Dashboard card that discovers EVERY notify.* action
// embedded across your automations and scripts (and, in future, template
// sensors), groups them by their source, and lets you browse, filter, and fully
// edit each notification (target, title, message, and nested platform options)
// — writing changes back via HA's REST config API.
//
// Author: LTek
// Version: v2026.09.11.22
//
// Changelog:
//   v2026.09.11.22 — Page-section titles now show their item range (e.g. "1–25")
//                    instead of "Page N" + a right-side range; total discovered
//                    count moved to the divider ([icon] [text] : [qty]).
//   v2026.09.11.21 — With Auto-Scan OFF, an unscanned group shows "Click 'Scan Now'
//                    to load details" instead of a "Loading config…" spinner.
//   v2026.09.11.20 — Fix: with Auto-Scan OFF, typing in the filter no longer
//                    triggers a scan (it only re-lists already-scanned results);
//                    scanning stays user-controlled via Scan Now.
//   v2026.09.11.19 — New defaults: title "Notifications Manager", divider on
//                    ("DISCOVERED NOTIFICATIONS", mdi:message-badge-outline),
//                    pagination on (25/page) as collapsible sections. Filter tip
//                    moved under the filter box (above Scan Now). Scan status
//                    reworded to "Auto-Scan On|Off : N sources".
//   v2026.09.11.18 — Scan status shows ONLY while actively scanning (not at rest);
//                    Tip on its own line; option to render each page as a
//                    collapsible section; styled section divider (user-defined text
//                    + icon, gradient lines) above the list.
//   v2026.09.11.17 — Progressive scan: the list (current page) fills in live as
//                    sources resolve. Scan status shows under the Scan Now button
//                    (replacing the description while scanning; description returns
//                    when done). "Last scan" now shows an absolute day + time.
//   v2026.09.11.16 — Single Scan Now button: removed the duplicate button in the
//                    list body; its description now shows under the top Scan Now
//                    button (list body just points up to it).
//   v2026.09.11.15 — Pagination (items-per-page setting; scan runs across all in
//                    the background, pages just limit what renders); "last scanned"
//                    time toggle next to Scan Now; Scan Now restyled with a dashed
//                    blue outline; optional header icon left of the title.
//   v2026.09.11.14 — Faster scan: raise config-fetch concurrency 5→12, and when a
//                    "filter by name" is set, only scan matching sources (fewer
//                    fetches). Broadening the filter fetches any newly-included
//                    sources on demand.
//   v2026.09.11.13 — Multi-level sorting: the Sort panel (card + editor defaults)
//                    now takes an ordered list of sort levels (primary first,
//                    later levels break ties), each with its own direction; add/
//                    remove levels, each key usable once. Legacy single-sort config
//                    migrates automatically.
//   v2026.09.11.12 — List polish: drop the leading source icon (the right-side
//                    type icon covers it); scripts/templates use a neutral type
//                    icon (only automations show enabled/disabled); add a
//                    collapsible Sort panel on the card + Sort defaults in the
//                    editor; editor toggles to show/hide the Display and Sort
//                    panels on the card face.
//   v2026.09.11.11 — Safety + list polish: undo last save, before→after save diff,
//                    pre-save template validation; type-icon enable/disable state
//                    (grey/green), round notification count chip, name size/weight
//                    setting, chevron on the card's Display Settings panel.
//   v2026.09.10.10 — Build C: duplicate & delete a notification in place —
//                    edit-mode Duplicate (insert a copy after) and Delete (splice
//                    out, with confirm), via a shared fetch→mutate→POST→reload path.
//   v2026.09.10.9 — Build B: selection-bar bulk actions — bulk test-fire, and
//                   bulk enable/disable the selection's parent automations
//                   (shown only when an automation is selected).
//   v2026.09.10.8 — Build A: test-fire a notification, enable/disable the parent
//                   automation inline, bulk retarget selected notifications, and
//                   click-a-target reverse lookup.
//   v2026.09.08.7 — Disable-auto-scan option + "Scan Now" button; setting hints.
//   v2026.09.08.6 — Background scan; render the list once when loading completes.
//   v2026.09.08.5 — Show entity id when a panel is expanded; normal-weight names.
//   v2026.09.08.3 — Editor panels use real summaries (title + right chevron).
//   v2026.09.08.2 — Scan scripts too; blueprint detection; Display Settings panel;
//                   lazy live-render; right-side icon cluster; open-in-HA.
//   v2026.09.08.1 — First release: discover + edit notify actions in automations.
//
// Design system: follows unified-cards/CARD_DESIGN_SYSTEM.md — the --ltek-*
// editor token block (byte-identical across cards), panel/row idioms,
// render-once + throttled updateStates, byte-stable sparse config,
// editMode/preview safety.
// ============================================================================

const BUILD_NUMBER = 'v2026.09.11.22';

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

// Absolute day + time for the "last scanned" readout (relative "just now" is
// meaningless there). e.g. "Thu Sep 11, 2:05 PM". Uses the browser locale.
function formatDayTime(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day}, ${time}`;
  } catch (e) { return String(date); }
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

// Deep clone that tolerates plain JSON-ish data (configs are).
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
// SOURCE TYPES
// ----------------------------------------------------------------------------
// The card scans several kinds of config objects for notify actions. Each
// source type knows its entity-domain prefix, how to derive an editable config
// id, the REST config path, the reload service, which key(s) hold its action
// tree, and how to deep-link into HA's editor.
// ============================================================================

const SOURCE_TYPES = {
  automation: {
    key: 'automation',
    label: 'Automation',
    icon: 'mdi:robot',
    prefix: 'automation.',
    idFrom: (hass, entityId) => {
      const st = hass && hass.states ? hass.states[entityId] : null;
      return (st && st.attributes && st.attributes.id) || null;
    },
    configPath: (id) => `config/automation/config/${id}`,
    reload: ['automation', 'reload'],
    actionKeys: ['action', 'actions'],
    editUrl: (id) => `/config/automation/edit/${id}`,
    stateFilterApplies: true
  },
  script: {
    key: 'script',
    label: 'Script',
    icon: 'mdi:script-text',
    prefix: 'script.',
    // Scripts are keyed by their object_id (the slug after "script.").
    idFrom: (hass, entityId) => entityId.split('.')[1] || null,
    configPath: (id) => `config/script/config/${id}`,
    reload: ['script', 'reload'],
    actionKeys: ['sequence'],
    editUrl: (id) => `/config/script/edit/${id}`,
    stateFilterApplies: false
  },
  // Template sensors: WIRING ONLY for now. The source type, the "Show Template
  // Sensors" toggle, and the enumeration hook exist, but scanning them requires
  // entity-registry platform detection and there's no per-entity editable action
  // tree, so no rows are produced yet.
  template: {
    key: 'template',
    label: 'Template Sensor',
    icon: 'mdi:code-braces',
    prefix: 'sensor.',
    idFrom: () => null,
    configPath: null,
    reload: null,
    actionKeys: [],
    editUrl: null,
    stateFilterApplies: false
  }
};

// ============================================================================
// NOTIFY DISCOVERY ENGINE
// ----------------------------------------------------------------------------
// A notify call can be nested arbitrarily deep in an action tree (inside
// choose/if-then-else/repeat/parallel/sequence). We WALK the tree to discover
// every notify call and record its exact PATH (array of keys/indices), so on
// save we can navigate a fresh deep-clone of the config to that path and mutate
// ONLY that node — never reformatting or losing unrelated branches.
// ============================================================================

// Table columns (the source itself is the group, so it's not a column).
const ALL_COLUMNS = ['target', 'title', 'message', 'last_triggered', 'enabled'];
const DEFAULT_COLUMNS = ['target', 'title', 'message'];

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
// the config root to `node`. Pushes { path, node } for each hit. Recurses by
// EXACT control-flow key so recorded paths are surgically accurate.
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

  if (Array.isArray(node.choose)) {
    for (let c = 0; c < node.choose.length; c++) {
      const branch = node.choose[c];
      if (branch && branch.sequence !== undefined) {
        walkNotifyActions(branch.sequence, path.concat('choose', c, 'sequence'), out);
      }
    }
  }
  if (node.default !== undefined) walkNotifyActions(node.default, path.concat('default'), out);
  if (node.then !== undefined) walkNotifyActions(node.then, path.concat('then'), out);
  if (node.else !== undefined) walkNotifyActions(node.else, path.concat('else'), out);
  if (isPlainObject(node.repeat) && node.repeat.sequence !== undefined) {
    walkNotifyActions(node.repeat.sequence, path.concat('repeat', 'sequence'), out);
  }
  if (node.sequence !== undefined) walkNotifyActions(node.sequence, path.concat('sequence'), out);
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

// Every recorded notify path ends in a numeric index inside an action array
// (walkNotifyActions only descends into arrays/sequences). Return the parent
// array and that index so we can splice — or null if the path isn't array-tailed
// or has drifted (the array/index no longer resolve to the expected node).
function resolveArraySlot(root, path) {
  if (!Array.isArray(path) || !path.length) return null;
  const idx = path[path.length - 1];
  if (typeof idx !== 'number') return null;
  const arr = getAtPath(root, path.slice(0, -1));
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return null;
  return { arr, idx };
}

// Normalize the many notify call-shapes into a common editable view.
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

// Write edited fields back into a notify node IN PLACE, preserving its shape and
// every sibling key. Deletes keys that become empty (byte-stable).
function applyNotifyFields(node, fields) {
  const key = (node.action !== undefined && node.service === undefined) ? 'action' : 'service';
  if (fields.service != null && fields.service !== '') {
    node[key] = fields.service;
  }

  if (fields.target && isPlainObject(fields.target) && Object.keys(fields.target).length) {
    node.target = deepClone(fields.target);
  } else if (node.target !== undefined && (fields.target === null || (isPlainObject(fields.target) && !Object.keys(fields.target).length))) {
    delete node.target;
  }

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

  const hasNested = fields.data && isPlainObject(fields.data) && Object.keys(fields.data).length;
  if (hasNested) {
    ensureData();
    data.data = deepClone(fields.data);
  } else if (data && data.data !== undefined) {
    delete data.data;
  }

  if (node.data && isPlainObject(node.data) && !Object.keys(node.data).length) {
    delete node.data;
  }
  return node;
}

// A config is blueprint-based when it carries use_blueprint.path. Its action
// tree lives in the blueprint (not in this config), so we can detect + name it
// but cannot introspect/edit its individual notify calls.
function blueprintPathOf(cfg) {
  if (isPlainObject(cfg) && isPlainObject(cfg.use_blueprint) && typeof cfg.use_blueprint.path === 'string') {
    return cfg.use_blueprint.path;
  }
  return null;
}

// ============================================================================
// CONFIG CACHE (module-level, per session) — keyed by "<type>:<id>"
// ============================================================================

const CFG_CACHE = { byKey: {} };   // "type:id" -> { status, config, error, fetchedAt }

// How many config fetches run concurrently during a scan. These are LOCAL calls
// to the HA instance (config/*/config/<id>), not a rate-limited cloud API, so a
// higher cap meaningfully cuts scan wall-clock. 12 is a safe, fast default.
const SCAN_CONCURRENCY = 12;

function _cacheKey(type, id) { return `${type}:${id}`; }
function _cacheEntry(type, id) {
  const k = _cacheKey(type, id);
  if (!CFG_CACHE.byKey[k]) CFG_CACHE.byKey[k] = { status: 'idle', config: null, error: null, fetchedAt: 0 };
  return CFG_CACHE.byKey[k];
}

function ensureSourceConfig(hass, type, id, onChange, force) {
  const def = SOURCE_TYPES[type];
  const e = _cacheEntry(type, id);
  if (!def || !def.configPath) { e.status = 'unsupported'; if (onChange) { try { onChange(type, id); } catch (x) {} } return; }
  if (!force && (e.status === 'loading' || e.status === 'loaded' || e.status === 'readonly')) return;
  if (!hass || typeof hass.callApi !== 'function') {
    e.status = 'error'; e.error = 'hass.callApi unavailable';
    if (onChange) { try { onChange(type, id); } catch (x) {} }
    return;
  }
  e.status = 'loading'; e.error = null;
  hass.callApi('GET', def.configPath(id))
    .then(cfg => {
      e.status = 'loaded'; e.config = cfg; e.fetchedAt = Date.now();
      if (onChange) { try { onChange(type, id); } catch (x) {} }
    })
    .catch(err => {
      // A 404/error here means it isn't editable via storage (YAML/packages).
      e.status = 'readonly'; e.error = formatWsError(err); e.fetchedAt = Date.now();
      if (onChange) { try { onChange(type, id); } catch (x) {} }
    });
}

// Background prefetch, concurrency-limited, so filters populate without blocking.
function ensureAllSourceConfigs(hass, items, onChange, limit) {
  // items: [{ type, id }]
  const queue = items.filter(it => {
    const def = SOURCE_TYPES[it.type];
    if (!def || !def.configPath) return false;
    return _cacheEntry(it.type, it.id).status === 'idle';
  });
  let active = 0;
  const max = limit || SCAN_CONCURRENCY;
  const pump = () => {
    while (active < max && queue.length) {
      const it = queue.shift();
      const def = SOURCE_TYPES[it.type];
      const e = _cacheEntry(it.type, it.id);
      if (e.status !== 'idle') continue;
      active++;
      e.status = 'loading'; e.error = null;
      hass.callApi('GET', def.configPath(it.id))
        .then(cfg => { e.status = 'loaded'; e.config = cfg; e.fetchedAt = Date.now(); })
        .catch(err => { e.status = 'readonly'; e.error = formatWsError(err); e.fetchedAt = Date.now(); })
        .then(() => { active--; if (onChange) { try { onChange(it.type, it.id); } catch (x) {} } pump(); });
    }
  };
  if (hass && typeof hass.callApi === 'function') pump();
}

// ============================================================================
// CONFIG (view prefs only — sparse + byte-stable)
// ============================================================================

const DEFAULT_FILTERS = { target: '', automation: '' };
const DEFAULT_DISPLAY = {
  has_title: true,               // show notifications that have a title
  has_no_title: true,            // show notifications with no title
  editable: true,                // show editable (storage-mode) sources
  not_editable: true,            // show read-only (YAML / blueprint) sources
  state_on: true,                // show automations whose state is on
  state_off: false,              // show automations whose state is off
  show_native: true,             // show non-blueprint automations
  show_blueprint: true,          // show blueprint-based automations
  show_scripts: true,            // scan + show scripts
  show_template_sensors: true    // scan + show template sensors (wiring only)
};

// Sorting. Keys map to comparable values on each group; direction asc/desc.
// The active sort is an ORDERED LIST of levels applied in sequence: the first
// level is primary, each subsequent level breaks ties of the ones before it
// (e.g. [type asc, name asc] = group by type, then A→Z within each type).
const SORT_KEYS = ['name', 'last_triggered', 'count', 'state', 'type'];
const SORT_LABELS = { name: 'Name', last_triggered: 'Last triggered', count: 'Notification count', state: 'State (on/off)', type: 'Source type' };
// Default = a single level: name ascending.
const DEFAULT_SORT = [{ by: 'name', dir: 'asc' }];

// Card defaults (kept as named constants so normalize + stub agree).
const DEFAULT_TITLE = 'Notifications Manager';
const DEFAULT_DIVIDER_TEXT = 'DISCOVERED NOTIFICATIONS';
const DEFAULT_DIVIDER_ICON = 'mdi:message-badge-outline';
const DEFAULT_PAGE_SIZE = 25;

function stubConfig() {
  return {
    type: 'custom:notification-manager-card',
    title: DEFAULT_TITLE,
    columns: DEFAULT_COLUMNS.slice(),
    filters: { ...DEFAULT_FILTERS },
    display: { ...DEFAULT_DISPLAY },
    sort: DEFAULT_SORT.map(l => ({ ...l })),
    show_display_panel: true,      // show the Display Settings panel on the card face
    show_sort_panel: true,         // show the Sort panel on the card face
    show_last_scan: false,         // show "last scanned <time>" next to Scan Now
    show_header_icon: false,       // show an icon left of the card title
    header_icon: 'mdi:bell-ring-outline',
    page_size: DEFAULT_PAGE_SIZE,  // 0 = no pagination; default paginates the list
    paged_sections: true,          // render each page as a collapsible section (default on)
    divider_text: DEFAULT_DIVIDER_TEXT,  // styled divider above the list (default on; '' = none)
    divider_icon: DEFAULT_DIVIDER_ICON,
    live_render: false,
    groups_default_open: true,
    open_groups: [],
    min_refresh_seconds: 0,
    disable_auto_scan: false,
    name_size: 14,
    name_weight: 400
  };
}

// Allowed label weights (kept to the token scale used across the cards).
const NAME_WEIGHTS = [400, 500, 600, 700];

function sameColumnSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.slice().sort().join(',') === b.slice().sort().join(',');
}

function normalizeFilters(f) {
  f = isPlainObject(f) ? f : {};
  return {
    target: typeof f.target === 'string' ? f.target : '',
    automation: typeof f.automation === 'string' ? f.automation : ''
  };
}
function filtersAreDefault(f) { return f.target === '' && f.automation === ''; }

function normalizeDisplay(d) {
  d = isPlainObject(d) ? d : {};
  const out = {};
  Object.keys(DEFAULT_DISPLAY).forEach(k => {
    out[k] = (typeof d[k] === 'boolean') ? d[k] : DEFAULT_DISPLAY[k];
  });
  return out;
}
function displayIsDefault(d) {
  return Object.keys(DEFAULT_DISPLAY).every(k => d[k] === DEFAULT_DISPLAY[k]);
}

function normalizeSortLevel(l) {
  l = isPlainObject(l) ? l : {};
  return {
    by: SORT_KEYS.includes(l.by) ? l.by : 'name',
    dir: l.dir === 'desc' ? 'desc' : 'asc'
  };
}
// Accept either the new ordered-list form or a legacy single {by,dir} object.
// Drop duplicate keys (a key can only sort once) and empty results → default.
function normalizeSort(s) {
  let levels;
  if (Array.isArray(s)) levels = s;
  else if (isPlainObject(s)) levels = [s];      // legacy single-object migration
  else levels = [];
  const seen = new Set();
  const out = [];
  levels.forEach(raw => {
    const l = normalizeSortLevel(raw);
    if (seen.has(l.by)) return;                 // one level per key
    seen.add(l.by);
    out.push(l);
  });
  return out.length ? out : DEFAULT_SORT.map(l => ({ ...l }));
}
function sortIsDefault(s) {
  return Array.isArray(s) && s.length === 1 && s[0].by === 'name' && s[0].dir === 'asc';
}

// Full normalized config used at RUNTIME (all keys present, defaults filled).
function normalizeConfigFull(config) {
  const stub = stubConfig();
  const cols = Array.isArray(config.columns) && config.columns.length
    ? config.columns.filter(c => ALL_COLUMNS.includes(c))
    : stub.columns;
  // Migrate v1 filter keys (state/has_title/editable_only) into display toggles.
  const migrated = {};
  if (isPlainObject(config.filters)) {
    if (config.filters.state === 'on') { migrated.state_on = true; migrated.state_off = false; }
    else if (config.filters.state === 'off') { migrated.state_on = false; migrated.state_off = true; }
    if (config.filters.has_title === true) { migrated.has_no_title = false; }
    if (config.filters.editable_only === true) { migrated.not_editable = false; }
  }
  // "absent → default, present → respect (incl. explicit empty/false)" for the
  // keys that now have non-empty/true defaults, so a user can override them (e.g.
  // blank the title, turn off pagination) and it survives normalize.
  const has = (k) => Object.prototype.hasOwnProperty.call(config, k);
  return {
    ...stub,
    ...config,
    title: has('title') ? (typeof config.title === 'string' ? config.title : '') : DEFAULT_TITLE,
    columns: cols.length ? cols : stub.columns,
    filters: normalizeFilters(config.filters),
    display: normalizeDisplay({ ...migrated, ...(isPlainObject(config.display) ? config.display : {}) }),
    sort: normalizeSort(config.sort),
    show_display_panel: config.show_display_panel !== false,
    show_sort_panel: config.show_sort_panel !== false,
    show_last_scan: !!config.show_last_scan,
    show_header_icon: !!config.show_header_icon,
    header_icon: (typeof config.header_icon === 'string' && config.header_icon.trim()) ? config.header_icon.trim() : 'mdi:bell-ring-outline',
    page_size: has('page_size') ? Math.max(0, Math.min(200, Math.floor(Number(config.page_size) || 0))) : DEFAULT_PAGE_SIZE,
    paged_sections: has('paged_sections') ? !!config.paged_sections : true,
    divider_text: has('divider_text') ? (typeof config.divider_text === 'string' ? config.divider_text : '') : DEFAULT_DIVIDER_TEXT,
    // Empty string is a valid value = "text, no icon"; only fall back to the
    // default when the key is absent entirely.
    divider_icon: has('divider_icon') ? (typeof config.divider_icon === 'string' ? config.divider_icon.trim() : '') : DEFAULT_DIVIDER_ICON,
    live_render: !!config.live_render,
    groups_default_open: config.groups_default_open !== false,
    open_groups: Array.isArray(config.open_groups) ? config.open_groups.filter(x => typeof x === 'string') : [],
    min_refresh_seconds: Math.max(0, Number(config.min_refresh_seconds) || 0),
    disable_auto_scan: !!config.disable_auto_scan,
    name_size: Math.min(28, Math.max(10, Number(config.name_size) || 14)),
    name_weight: NAME_WEIGHTS.includes(Number(config.name_weight)) ? Number(config.name_weight) : 400
  };
}

// SPARSE normalized config for EMISSION (byte-stable): drop keys equal to default.
function normalizeConfig(config) {
  const full = normalizeConfigFull(config || {});
  const out = { type: full.type || 'custom:notification-manager-card' };
  // Title defaults to DEFAULT_TITLE → emit only when overridden (incl. explicit blank).
  if (full.title !== DEFAULT_TITLE) out.title = full.title;
  if (!sameColumnSet(full.columns, DEFAULT_COLUMNS)) {
    out.columns = ALL_COLUMNS.filter(c => full.columns.includes(c));
  }
  if (!filtersAreDefault(full.filters)) {
    const f = {};
    if (full.filters.target) f.target = full.filters.target;
    if (full.filters.automation) f.automation = full.filters.automation;
    out.filters = f;
  }
  if (!displayIsDefault(full.display)) {
    const d = {};
    Object.keys(DEFAULT_DISPLAY).forEach(k => { if (full.display[k] !== DEFAULT_DISPLAY[k]) d[k] = full.display[k]; });
    out.display = d;
  }
  if (!sortIsDefault(full.sort)) out.sort = full.sort.map(l => ({ ...l }));
  if (full.show_display_panel === false) out.show_display_panel = false;
  if (full.show_sort_panel === false) out.show_sort_panel = false;
  if (full.show_last_scan) out.show_last_scan = true;
  if (full.show_header_icon) out.show_header_icon = true;
  if (full.header_icon && full.header_icon !== 'mdi:bell-ring-outline') out.header_icon = full.header_icon;
  // These now default to non-zero/true/non-empty → emit only when they differ.
  if (full.page_size !== DEFAULT_PAGE_SIZE) out.page_size = full.page_size;
  if (full.paged_sections !== true) out.paged_sections = full.paged_sections;
  if (full.divider_text !== DEFAULT_DIVIDER_TEXT) out.divider_text = full.divider_text;   // '' = no divider (explicit)
  if (full.divider_icon !== DEFAULT_DIVIDER_ICON) out.divider_icon = full.divider_icon;   // '' = text-only (explicit)
  if (full.live_render) out.live_render = true;
  if (full.groups_default_open === false) out.groups_default_open = false;
  if (full.open_groups.length) out.open_groups = full.open_groups.slice();
  if (full.min_refresh_seconds > 0) out.min_refresh_seconds = full.min_refresh_seconds;
  if (full.disable_auto_scan) out.disable_auto_scan = true;
  if (full.name_size !== 14) out.name_size = full.name_size;
  if (full.name_weight !== 400) out.name_weight = full.name_weight;
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
    this._rows = [];
    this._groups = [];
    this._edit = false;
    this._prev = false;
    this._editMode = false;
    this._viewFilters = null;      // { target, automation }
    this._viewDisplay = null;      // display toggles (runtime copy)
    this._viewSort = null;         // { by, dir } (runtime copy)
    this._viewColumns = null;
    this._liveRender = false;
    this._openState = {};          // group key -> bool
    this._selection = new Set();   // rowIds selected for bulk actions
    this._page = 0;                // current page index (when pagination on)
    this._scanning = false;        // true only while a scan is actively running
    this._lastScanAt = 0;          // timestamp of the last completed scan
    this._tpl = { subs: new Map(), enabled: false };
  }

  disconnectedCallback() {
    if (this._updateTimer) { clearTimeout(this._updateTimer); this._updateTimer = null; }
    if (this._progressTimer) { clearTimeout(this._progressTimer); this._progressTimer = null; }
    this._teardownAllTpl();
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = normalizeConfigFull(config);
    DEBUG = !!config.debug;
    this._viewFilters = { ...this._config.filters };
    this._viewDisplay = { ...this._config.display };
    this._viewSort = this._config.sort.map(l => ({ ...l }));
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

  set editMode(v) { this._edit = !!v; this._editMode = this._edit || this._prev; }
  get editMode() { return this._edit === true; }
  set preview(v) { this._prev = !!v; this._editMode = this._edit || this._prev; }
  get preview() { return this._prev === true; }

  getCardSize() {
    const groups = (this._groups && this._groups.length) || 3;
    return Math.min(20, groups * 2 + 2);
  }

  static getConfigElement() {
    return document.createElement('notification-manager-card-editor');
  }
  static getStubConfig() { return { type: 'custom:notification-manager-card' }; }

  // ------------------------------------------------------------------------
  // SOURCE ENUMERATION
  // ------------------------------------------------------------------------
  // Every source entity we might scan, honoring the Show * display toggles.
  // Returns [{ type, entityId, id }]. Template sensors: wiring only (id null,
  // not fetched), so they never actually produce rows yet.
  _sourceItems() {
    const hass = this._hass;
    const d = this._viewDisplay || DEFAULT_DISPLAY;
    if (!hass || !hass.states) return [];
    const items = [];
    const ids = Object.keys(hass.states);
    if (d.show_native || d.show_blueprint) {
      ids.filter(e => e.indexOf('automation.') === 0).forEach(e => {
        items.push({ type: 'automation', entityId: e, id: SOURCE_TYPES.automation.idFrom(hass, e) });
      });
    }
    if (d.show_scripts) {
      ids.filter(e => e.indexOf('script.') === 0).forEach(e => {
        items.push({ type: 'script', entityId: e, id: SOURCE_TYPES.script.idFrom(hass, e) });
      });
    }
    // Template sensors: enumeration hook is intentionally inert for now.
    return items.sort((a, b) => a.entityId.localeCompare(b.entityId));
  }

  _fetchableItems() {
    let items = this._sourceItems().filter(it => it.id && SOURCE_TYPES[it.type] && SOURCE_TYPES[it.type].configPath);
    // SPEEDUP: if a name filter is set, only fetch the configs of sources whose
    // name/entity_id matches — we already know names from hass.states, so we can
    // narrow the (expensive) config fetches before doing any network calls. This
    // pairs with the pre-Scan filter: type a name, hit Scan Now, fetch only those.
    const q = (this._viewFilters && this._viewFilters.automation || '').trim().toLowerCase();
    if (q) {
      const hass = this._hass;
      items = items.filter(it => {
        const st = hass && hass.states ? hass.states[it.entityId] : null;
        const name = (st && st.attributes && st.attributes.friendly_name) || it.entityId;
        return (name + ' ' + it.entityId).toLowerCase().indexOf(q) !== -1;
      });
    }
    return items;
  }

  // ------------------------------------------------------------------------
  // DISCOVERY — build the row + group model from cached configs.
  // ------------------------------------------------------------------------
  _buildRows() {
    const hass = this._hass;
    const rows = [];
    const groups = [];
    this._sourceItems().forEach(it => {
      const def = SOURCE_TYPES[it.type];
      const st = hass.states[it.entityId];
      if (!st) return;
      const name = (st.attributes && st.attributes.friendly_name) || it.entityId;
      const cfgId = it.id;
      const entry = cfgId && def.configPath ? _cacheEntry(it.type, cfgId) : { status: 'unsupported', config: null, error: null };
      const cfg = entry.config || null;
      const isBlueprint = cfg ? !!blueprintPathOf(cfg) : false;
      const g = {
        key: `${it.type}:${cfgId || it.entityId}`,
        sourceType: it.type,
        entityId: it.entityId,
        configId: cfgId,
        name,
        state: st.state,
        lastTriggered: st.attributes && st.attributes.last_triggered,
        editable: false,
        status: cfgId && def.configPath ? entry.status : 'unsupported',
        error: entry.error || (def.configPath ? null : 'Scanning not yet supported for this source.'),
        isBlueprint,
        blueprintPath: isBlueprint ? blueprintPathOf(cfg) : null,
        rows: []
      };
      if (cfgId && def.configPath && entry.status === 'loaded' && cfg) {
        if (isBlueprint) {
          g.editable = false;   // blueprint config holds no editable action tree
        } else {
          let actionKey = null, actions;
          for (const k of def.actionKeys) { if (cfg[k] !== undefined) { actionKey = k; actions = cfg[k]; break; } }
          if (actionKey === null) actionKey = def.actionKeys[0];
          const hits = [];
          if (actions !== undefined) walkNotifyActions(actions, [actionKey], hits);
          g.editable = true;
          hits.forEach(h => {
            const f = extractNotifyFields(h.node);
            const rowId = `${it.type}:${cfgId}::${JSON.stringify(h.path)}`;
            const prior = this._rowById(rowId);
            rows.push({
              rowId, sourceType: it.type, entityId: it.entityId, configId: cfgId,
              name, state: st.state, lastTriggered: g.lastTriggered, editable: true,
              path: h.path, callShape: f.callShape, service: f.service, target: f.target,
              title: f.title, message: f.message, data: f.data,
              _dirty: prior ? prior._dirty : false,
              _edit: prior ? prior._edit : false,
              _draft: prior ? prior._draft : null
            });
            g.rows.push(rowId);
          });
        }
      }
      // Keep groups that: have rows, are loading, are blueprint (to show the
      // badge), or errored/readonly with a config id (to show why). Skip loaded
      // sources with no notify calls, and unsupported (template) sources.
      const keep = g.rows.length
        || g.status === 'loading' || g.status === 'idle'
        || g.isBlueprint
        || (cfgId && def.configPath && g.status === 'readonly');
      if (keep) groups.push(g);
    });
    this._rows = rows;
    this._groups = groups;
    return { rows, groups };
  }

  _rowById(rowId) { return (this._rows || []).find(r => r.rowId === rowId) || null; }
  _groupByKey(key) { return (this._groups || []).find(g => g.key === key) || null; }

  // ------------------------------------------------------------------------
  // FILTERS
  // ------------------------------------------------------------------------
  _rowVisible(r) {
    const d = this._viewDisplay || DEFAULT_DISPLAY;
    const hasTitle = !!(r.title && r.title.trim());
    if (hasTitle && !d.has_title) return false;
    if (!hasTitle && !d.has_no_title) return false;
    return true;
  }

  _visibleRows(g) {
    return g.rows.map(id => this._rowById(id)).filter(Boolean).filter(r => this._rowVisible(r));
  }

  _groupVisible(g) {
    const d = this._viewDisplay || DEFAULT_DISPLAY;
    const f = this._viewFilters || DEFAULT_FILTERS;
    if (g.sourceType === 'automation') {
      if (g.isBlueprint && !d.show_blueprint) return false;
      if (!g.isBlueprint && !d.show_native) return false;
    } else if (g.sourceType === 'script') {
      if (!d.show_scripts) return false;
    } else if (g.sourceType === 'template') {
      if (!d.show_template_sensors) return false;
    }
    if (g.editable && !d.editable) return false;
    if (!g.editable && !d.not_editable) return false;
    const def = SOURCE_TYPES[g.sourceType];
    if (def && def.stateFilterApplies) {
      if (g.state === 'on' && !d.state_on) return false;
      if (g.state === 'off' && !d.state_off) return false;
    }
    if (f.automation) {
      const hay = (g.name + ' ' + g.entityId).toLowerCase();
      if (hay.indexOf(f.automation.toLowerCase()) === -1) return false;
    }
    if (f.target) {
      const t = f.target.toLowerCase();
      const grows = g.rows.map(id => this._rowById(id)).filter(Boolean);
      const any = grows.some(r => {
        const svc = (r.service || '').toLowerCase();
        const tgt = r.target ? JSON.stringify(r.target).toLowerCase() : '';
        return svc.indexOf(t) !== -1 || tgt.indexOf(t) !== -1;
      });
      if (!any && grows.length) return false;
    }
    return true;
  }

  _filteredGroups() {
    const filtered = (this._groups || []).filter(g => {
      if (!this._groupVisible(g)) return false;
      if (g.editable && g.status === 'loaded' && g.rows.length && !this._visibleRows(g).length) return false;
      return true;
    });
    return this._sortGroups(filtered);
  }

  // Multi-level sort: apply each level in order; the first non-equal level wins,
  // later levels break ties. A final name tiebreak keeps the order stable.
  _sortGroups(groups) {
    const levels = (this._viewSort && this._viewSort.length) ? this._viewSort : DEFAULT_SORT;
    const typeRank = { automation: 0, script: 1, template: 2 };
    const cmpBy = (by, a, b) => {
      if (by === 'name') return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase());
      const val = (g) => {
        switch (by) {
          case 'last_triggered': return g.lastTriggered ? new Date(g.lastTriggered).getTime() : 0;
          case 'count': return this._visibleRows(g).length;
          case 'state': return g.state === 'on' ? 1 : 0;
          case 'type': return (g.isBlueprint ? 10 : 0) + (typeRank[g.sourceType] != null ? typeRank[g.sourceType] : 9);
          default: return 0;
        }
      };
      const va = val(a), vb = val(b);
      return va < vb ? -1 : (va > vb ? 1 : 0);
    };
    return groups.slice().sort((a, b) => {
      for (const lvl of levels) {
        const c = cmpBy(lvl.by, a, b) * (lvl.dir === 'desc' ? -1 : 1);
        if (c !== 0) return c;
      }
      // Stable final tiebreak by name (ascending) when all levels tie.
      return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase());
    });
  }

  _allTargets() {
    const set = new Set();
    (this._rows || []).forEach(r => { if (r.service) set.add(r.service); });
    return Array.from(set).sort();
  }

  _isOpen(key) {
    if (Object.prototype.hasOwnProperty.call(this._openState, key)) return this._openState[key];
    const cfg = this._config || {};
    const inList = Array.isArray(cfg.open_groups) && cfg.open_groups.includes(key);
    return cfg.groups_default_open ? !inList : inList;
  }

  // ------------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------------
  renderCard() {
    if (!this._hass || !this._config) return;

    const items = this._fetchableItems();
    const cols = this._viewColumns || DEFAULT_COLUMNS;
    // Are all source configs already resolved (loaded/readonly/unsupported)?
    const pending = items.filter(it => { const e = _cacheEntry(it.type, it.id); return e.status === 'idle' || e.status === 'loading'; });
    this._loadComplete = pending.length === 0;

    this.innerHTML = `
      <ha-card class="anm-wrap">
        <style>${this._styles()}</style>
        ${this._renderHeader()}
        ${this._renderToolbar()}
        ${this._renderDivider()}
        <div class="anm-groups" data-cols="${cols.join(' ')}"></div>
      </ha-card>
    `;
    this._applyColumnVisibility();
    this._attachToolbarHandlers();

    if (this._loadComplete) {
      // Everything already cached (e.g. re-render, or a prior manual scan) —
      // build + show immediately.
      this._scanning = false;
      this._buildRows();
      this._renderGroupList();
      this._refreshScanStatus();
    } else if (this._config.disable_auto_scan && !this._scanRequested) {
      // Auto-scan disabled: don't hit the config API on load. Wait for the user
      // to press "Scan Now" (which sets _scanRequested and re-renders).
      this._scanning = false;
      this._showScanPrompt(items.length);
      this._refreshScanStatus();
    } else {
      // Scan ALL source configs in the background. The list renders
      // PROGRESSIVELY as configs resolve (each page fills in as its sources are
      // found), and the top scan-status line shows progress until done.
      const total = items.length;
      this._scanning = true;
      this._buildRows();
      this._renderGroupList();
      this._refreshScanStatus();
      ensureAllSourceConfigs(this._hass, items, () => this._onLoadProgress(total), SCAN_CONCURRENCY);
    }
  }

  // The scan-status line under the Scan Now button (when not actively scanning).
  // Format: "Auto-Scan On|Off : N sources" — N reflects the current name filter.
  _scanHintText() {
    const total = this._fetchableItems().length;
    const on = !this._config.disable_auto_scan;
    return `Auto-Scan ${on ? 'On' : 'Off'} : ${total} source${total === 1 ? '' : 's'}`;
  }

  // The tip shown under the filter input box (only useful when auto-scan is off,
  // since that's when narrowing the filter reduces the scan set).
  _filterTipHtml() {
    if (!this._config.disable_auto_scan) return '';
    return `<div class="anm-filter-tip">Tip: type a name filter first to scan only matching sources.</div>`;
  }

  // The groups area, before the first scan, just points to the top Scan Now button
  // (the button + full description now live in the toolbar).
  _showScanPrompt(/* total */) {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) return;
    wrap.innerHTML = `<div class="anm-empty">Press <b>Scan Now</b> above to load notifications.</div>`;
  }

  // True ONLY while a scan is actively running (set when a scan is kicked off,
  // cleared when it completes). Being "not yet scanned" (idle sources) is NOT
  // scanning — that shows the description, not a progress line.
  _isScanning() {
    return this._scanning === true && !this._loadComplete;
  }
  _scanProgress() {
    const items = this._fetchableItems();
    const done = items.filter(it => { const e = _cacheEntry(it.type, it.id); return e.status !== 'idle' && e.status !== 'loading'; }).length;
    return { done, total: items.length };
  }

  // The top status line (under Scan Now): shows scan progress WHILE scanning,
  // and reverts to the description text when idle/finished.
  _scanStatusHtml() {
    if (this._isScanning()) {
      const { done, total } = this._scanProgress();
      return `<div class="anm-scan-hint anm-scan-progress"><span class="anm-spinner"></span> Scanning ${done}/${total} sources for notifications…</div>`;
    }
    // Not scanning → the description text (with the Tip on its own line).
    return `<div class="anm-scan-hint">${this._scanHintText()}</div>`;
  }
  // Replace the status slot in place (no full toolbar rebuild).
  _refreshScanStatus() {
    const slot = this.querySelector('.anm-scan-status');
    if (slot) slot.innerHTML = this._scanStatusHtml();
  }

  // Progress callback: fires per resolved config. Updates the top status line and
  // PROGRESSIVELY re-renders the current page (throttled) so results appear as
  // they're found; when the last one lands, does a final render.
  _onLoadProgress(total) {
    if (!this._hass || this._loadComplete) return;
    const { done } = this._scanProgress();
    this._refreshScanStatus();
    if (done >= total) {
      this._loadComplete = true;
      this._scanning = false;
      this._lastScanAt = Date.now();
      if (this._progressTimer) { clearTimeout(this._progressTimer); this._progressTimer = null; }
      this._buildRows();
      this._renderGroupList();
      this._refreshToolbarTargets();
      this._refreshScanStatus();
      this._refreshLastScan();
    } else if (!this._progressTimer) {
      // Throttle progressive re-renders to ~300ms so a fast burst of resolutions
      // doesn't rebuild the list on every single one.
      this._progressTimer = setTimeout(() => {
        this._progressTimer = null;
        if (this._loadComplete) return;
        this._buildRows();
        this._renderGroupList();
        this._refreshToolbarTargets();
      }, 300);
    }
  }

  _lastScanText() {
    if (!this._lastScanAt) return 'Not scanned yet';
    return 'Last scan: ' + formatDayTime(this._lastScanAt);
  }
  _refreshLastScan() {
    const el = this.querySelector('.anm-last-scan');
    if (el) el.textContent = this._lastScanText();
  }

  // Name filter changed. Because the filter also NARROWS the scan set, broadening
  // it can bring in sources we never fetched. If the current match set has any
  // un-scanned items (and scanning is allowed), scan just those; otherwise re-list.
  _onNameFilterChanged(value) {
    this._viewFilters.automation = value;
    this._refreshScanStatus();   // the "N sources" count reflects the filter
    // When Auto-Scan is OFF, typing in the filter must NEVER kick a scan — the
    // user controls scanning via the Scan Now button. Only re-list what's already
    // been scanned. (Auto-scan ON may fetch newly-included sources on the fly.)
    if (this._config.disable_auto_scan) {
      this._page = 0;
      if (this._loadComplete) this._renderGroupList();
      return;
    }
    const items = this._fetchableItems();
    const pending = items.filter(it => { const e = _cacheEntry(it.type, it.id); return e.status === 'idle' || e.status === 'loading'; });
    if (pending.length) {
      // Auto-scan on: fetch the newly-included sources; the list renders
      // progressively as they resolve, status shows progress until done.
      this._loadComplete = false;
      this._scanning = true;
      const total = items.length;
      this._page = 0;
      this._buildRows();
      this._renderGroupList();
      this._refreshScanStatus();
      ensureAllSourceConfigs(this._hass, items, () => this._onLoadProgress(total), SCAN_CONCURRENCY);
    } else if (this._loadComplete) {
      this._renderGroupList();
    }
  }

  // Styled section divider above the list: gradient lines flanking a centered
  // icon + label (like the EES/Color group divider). Renders only when a
  // divider_text is set. Icon optional (blank icon → just the text).
  _renderDivider() {
    const c = this._config;
    const text = (c.divider_text || '').trim();
    if (!text) return '';
    const icon = (c.divider_icon || '').trim();
    const iconHtml = icon ? `<ha-icon icon="${escapeHtml(icon)}"></ha-icon>` : '';
    // Trailing ": N" = total discovered sources (filled/updated after each render).
    return `<div class="anm-divider"><span class="anm-divider-label">${iconHtml}<span>${escapeHtml(text)}</span><span class="anm-divider-count">${this._dividerCountText()}</span></span></div>`;
  }

  // "" until the first scan; then " : N" (total discovered sources in the list).
  _dividerCountText() {
    if (!this._loadComplete) return '';
    const n = (this._filteredGroups() || []).length;
    return ` : ${n}`;
  }
  _refreshDividerCount() {
    const el = this.querySelector('.anm-divider-count');
    if (el) el.textContent = this._dividerCountText();
  }

  // Card header: optional icon (left of the title) + optional title. Renders only
  // when there's a title and/or the header icon is enabled.
  _renderHeader() {
    const c = this._config;
    const hasTitle = !!(c.title && c.title.trim());
    if (!hasTitle && !c.show_header_icon) return '';
    const icon = c.show_header_icon ? `<ha-icon class="anm-header-icon" icon="${escapeHtml(c.header_icon || 'mdi:bell-ring-outline')}"></ha-icon>` : '';
    const title = hasTitle ? `<span class="anm-header-title">${escapeHtml(c.title)}</span>` : '';
    return `<div class="anm-header">${icon}${title}</div>`;
  }

  // Build the (filtered) group list into the container and wire group handlers.
  // When pagination is on (page_size > 0), only the current page's groups render;
  // pager controls are appended below.
  _renderGroupList() {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) return;
    this._teardownAllTpl();
    const filtered = this._filteredGroups();
    const size = this._config.page_size || 0;
    if (!filtered.length) {
      wrap.innerHTML = this._isScanning()
        ? `<div class="anm-loading"><span class="anm-spinner"></span> Scanning for notifications…</div>`
        : `<div class="anm-empty">No sources with notifications match the current Display Settings.</div>`;
    } else if (size > 0 && this._config.paged_sections) {
      // Each page as its own collapsible section (all pages shown at once).
      const pageCount = Math.max(1, Math.ceil(filtered.length / size));
      let html = '';
      for (let p = 0; p < pageCount; p++) {
        const slice = filtered.slice(p * size, (p + 1) * size);
        const from = p * size + 1, to = Math.min(filtered.length, (p + 1) * size);
        const open = this._pageSectionOpen(p);
        html += `
          <details class="anm-page-sec" data-page="${p}"${open ? ' open' : ''}>
            <summary class="anm-page-sum"><ha-icon class="anm-page-chev" icon="mdi:chevron-down"></ha-icon><span>${from}–${to}</span></summary>
            <div class="anm-page-body">${slice.map(g => this._renderGroup(g)).join('')}</div>
          </details>`;
      }
      wrap.innerHTML = html;
      this._attachPageSectionHandlers();
    } else if (size > 0) {
      const pageCount = Math.max(1, Math.ceil(filtered.length / size));
      if (this._page >= pageCount) this._page = pageCount - 1;
      if (this._page < 0) this._page = 0;
      const start = this._page * size;
      const pageGroups = filtered.slice(start, start + size);
      wrap.innerHTML = pageGroups.map(g => this._renderGroup(g)).join('') + this._renderPager(filtered.length, pageCount, size);
      this._attachPagerHandlers();
    } else {
      wrap.innerHTML = filtered.map(g => this._renderGroup(g)).join('');
    }
    this._applyColumnVisibility();
    this._attachGroupHandlers();
    this._refreshDividerCount();
    if (this._liveRender) this._enableLiveRenderOpenGroups();
  }

  _renderPager(totalGroups, pageCount, size) {
    const from = this._page * size + 1;
    const to = Math.min(totalGroups, (this._page + 1) * size);
    return `
      <div class="anm-pager">
        <button class="anm-pg-prev" ${this._page <= 0 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-left"></ha-icon></button>
        <span class="anm-pg-info">${from}–${to} of ${totalGroups} · page ${this._page + 1}/${pageCount}</span>
        <button class="anm-pg-next" ${this._page >= pageCount - 1 ? 'disabled' : ''}><ha-icon icon="mdi:chevron-right"></ha-icon></button>
      </div>`;
  }

  _attachPagerHandlers() {
    const prev = this.querySelector('.anm-pg-prev');
    if (prev) prev.addEventListener('click', () => { this._page = Math.max(0, this._page - 1); this._renderGroupList(); });
    const next = this.querySelector('.anm-pg-next');
    if (next) next.addEventListener('click', () => { this._page = this._page + 1; this._renderGroupList(); });
  }

  // Paged-sections open state — first page open by default; user toggles persist.
  _pageSectionOpen(p) {
    if (!this._pageOpen) this._pageOpen = {};
    if (Object.prototype.hasOwnProperty.call(this._pageOpen, p)) return this._pageOpen[p];
    return p === 0;
  }
  _attachPageSectionHandlers() {
    this.querySelectorAll('.anm-page-sec').forEach(d => {
      d.addEventListener('toggle', () => {
        if (!this._pageOpen) this._pageOpen = {};
        this._pageOpen[Number(d.getAttribute('data-page'))] = d.open;
        // Opening a page can bring template cells into view — refresh live subs.
        if (this._liveRender) { if (d.open) this._subscribeCellsIn(d); else this._unsubscribeCellsIn(d); }
      });
    });
  }

  _renderToolbar() {
    const f = this._viewFilters || DEFAULT_FILTERS;
    const d = this._viewDisplay || DEFAULT_DISPLAY;
    const targets = this._allTargets();
    const cols = this._viewColumns || DEFAULT_COLUMNS;
    const dchk = (k, label) => `<label class="anm-chk"><input type="checkbox" class="anm-d" data-d="${k}"${d[k] ? ' checked' : ''}> ${label}</label>`;
    return `
      <div class="anm-toolbar">
        <div class="anm-toolbar-filters">
          <input class="anm-f-name" type="text" placeholder="Filter by name…" value="${escapeHtml(f.automation)}">
          <select class="anm-f-target">
            <option value="">All targets</option>
            ${targets.map(t => `<option value="${escapeHtml(t)}"${t === f.target ? ' selected' : ''}>${escapeHtml(t.replace('notify.', ''))}</option>`).join('')}
          </select>
          <label class="anm-chk anm-live-toggle"><input type="checkbox" class="anm-live"${this._liveRender ? ' checked' : ''}> Live render</label>
        </div>
        <div class="anm-filter-tip-slot">${this._filterTipHtml()}</div>
        <div class="anm-toolbar-main">
          <button class="anm-refresh" title="Re-scan all sources for notifications"><ha-icon icon="mdi:refresh"></ha-icon> Scan Now</button>
          ${this._config.show_last_scan ? `<span class="anm-last-scan">${this._lastScanText()}</span>` : ''}
        </div>
        <div class="anm-scan-status">${this._scanStatusHtml()}</div>
        ${this._renderSelectionBar()}
        ${this._config.show_sort_panel ? this._renderSortPanel() : ''}
        ${this._config.show_display_panel ? `
        <details class="anm-display" data-panel="display">
          <summary class="anm-display-sum"><ha-icon icon="mdi:tune-variant"></ha-icon> <span class="anm-display-title">Display Settings</span><ha-icon class="anm-display-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-display-body">
            <div class="anm-d-group">
              <div class="anm-d-title">Show sources</div>
              ${dchk('show_native', 'Native Automations')}
              ${dchk('show_blueprint', 'Blueprint Automations')}
              ${dchk('show_scripts', 'Scripts')}
              ${dchk('show_template_sensors', 'Template Sensors')}
            </div>
            <div class="anm-d-group">
              <div class="anm-d-title">Editability</div>
              ${dchk('editable', 'Editable')}
              ${dchk('not_editable', 'Not Editable')}
            </div>
            <div class="anm-d-group">
              <div class="anm-d-title">Automation state</div>
              ${dchk('state_on', 'State = On')}
              ${dchk('state_off', 'State = Off')}
            </div>
            <div class="anm-d-group">
              <div class="anm-d-title">Notifications</div>
              ${dchk('has_title', 'Has Title')}
              ${dchk('has_no_title', 'Has No Title')}
            </div>
            <div class="anm-d-group">
              <div class="anm-d-title">Columns</div>
              ${ALL_COLUMNS.map(c => `<label class="anm-chk"><input type="checkbox" class="anm-col" data-col="${c}"${cols.includes(c) ? ' checked' : ''}> ${this._colLabel(c)}</label>`).join('')}
            </div>
          </div>
        </details>` : ''}
      </div>
    `;
  }

  // Collapsible Sort panel on the card face — one row per sort level, applied in
  // order (primary first, later levels break ties). Add/remove levels; each key
  // can be used once (keys already chosen are disabled in other rows).
  _renderSortPanel() {
    const levels = (this._viewSort && this._viewSort.length) ? this._viewSort : DEFAULT_SORT;
    const used = levels.map(l => l.by);
    const rowsHtml = levels.map((lvl, i) => this._renderSortLevelRow(lvl, i, used)).join('');
    const canAdd = levels.length < SORT_KEYS.length;
    return `
      <details class="anm-sort" data-panel="sort">
        <summary class="anm-display-sum"><ha-icon icon="mdi:sort"></ha-icon> <span class="anm-display-title">Sort</span><ha-icon class="anm-display-chev" icon="mdi:chevron-down"></ha-icon></summary>
        <div class="anm-sort-body">
          <div class="anm-sort-levels">${rowsHtml}</div>
          ${canAdd ? `<button class="anm-sort-add" title="Add another sort level">+ Add sort level</button>` : ''}
        </div>
      </details>`;
  }

  _renderSortLevelRow(lvl, i, used) {
    const label = i === 0 ? 'Sort by' : 'then by';
    // A key is selectable if it's this row's key or not used by another row.
    const opts = SORT_KEYS.map(k => `<option value="${k}"${lvl.by === k ? ' selected' : ''}${(used.includes(k) && k !== lvl.by) ? ' disabled' : ''}>${SORT_LABELS[k]}</option>`).join('');
    return `
      <div class="anm-sort-row" data-idx="${i}">
        <span class="anm-sort-lbl">${label}</span>
        <select class="anm-sort-by">${opts}</select>
        <select class="anm-sort-dir">
          <option value="asc"${lvl.dir === 'asc' ? ' selected' : ''}>Asc</option>
          <option value="desc"${lvl.dir === 'desc' ? ' selected' : ''}>Desc</option>
        </select>
        <button class="anm-sort-del" title="Remove this sort level"${(used.length <= 1) ? ' disabled' : ''}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>`;
  }

  // Rebuild just the Sort panel body in place (after add/remove/change), so the
  // used-key disabling + row labels stay correct without a full toolbar rebuild.
  _refreshSortPanel() {
    const panel = this.querySelector('.anm-sort');
    if (!panel) return;
    const body = panel.querySelector('.anm-sort-body');
    if (!body) return;
    const levels = (this._viewSort && this._viewSort.length) ? this._viewSort : DEFAULT_SORT;
    const used = levels.map(l => l.by);
    const canAdd = levels.length < SORT_KEYS.length;
    body.innerHTML = `<div class="anm-sort-levels">${levels.map((lvl, i) => this._renderSortLevelRow(lvl, i, used)).join('')}</div>`
      + (canAdd ? `<button class="anm-sort-add" title="Add another sort level">+ Add sort level</button>` : '');
    this._attachSortHandlers();
  }

  // Wire the multi-level Sort panel controls. Changing a level's key/dir re-lists;
  // structural changes (add/remove, or a key change that must disable others)
  // rebuild the panel body so the disabled-options + labels stay correct.
  _attachSortHandlers() {
    const root = this;
    const relist = () => { this._page = 0; if (this._loadComplete) this._renderGroupList(); };
    const levels = () => { if (!Array.isArray(this._viewSort) || !this._viewSort.length) this._viewSort = DEFAULT_SORT.map(l => ({ ...l })); return this._viewSort; };
    root.querySelectorAll('.anm-sort-row').forEach(rowEl => {
      const idx = Number(rowEl.getAttribute('data-idx'));
      const by = rowEl.querySelector('.anm-sort-by');
      const dir = rowEl.querySelector('.anm-sort-dir');
      if (by) by.addEventListener('change', () => { const L = levels(); if (L[idx]) L[idx].by = by.value; relist(); this._refreshSortPanel(); });
      if (dir) dir.addEventListener('change', () => { const L = levels(); if (L[idx]) L[idx].dir = dir.value; relist(); });
      const del = rowEl.querySelector('.anm-sort-del');
      if (del) del.addEventListener('click', () => {
        const L = levels();
        if (L.length <= 1) return;   // keep at least one level
        L.splice(idx, 1);
        relist(); this._refreshSortPanel();
      });
    });
    const add = root.querySelector('.anm-sort-add');
    if (add) add.addEventListener('click', () => {
      const L = levels();
      const unused = SORT_KEYS.find(k => !L.some(l => l.by === k));
      if (!unused) return;
      L.push({ by: unused, dir: 'asc' });
      relist(); this._refreshSortPanel();
    });
  }

  // Selection bar for bulk actions — visible only when ≥1 row is selected.
  // Enable/Disable act on the distinct parent automations of the selection;
  // they only appear when the selection covers at least one automation.
  _renderSelectionBar() {
    const n = this._selection ? this._selection.size : 0;
    if (!n) return '';
    const rows = Array.from(this._selection).map(id => this._rowById(id)).filter(Boolean);
    const hasAutomation = rows.some(r => r.sourceType === 'automation');
    const autoBtns = hasAutomation
      ? `<button class="anm-selbar-enable">Enable</button>
        <button class="anm-selbar-disable">Disable</button>`
      : '';
    return `
      <div class="anm-selbar">
        <span class="anm-selbar-count">${n} selected</span>
        <button class="anm-selbar-test">Test…</button>
        ${autoBtns}
        <button class="anm-selbar-retarget">Retarget…</button>
        <button class="anm-selbar-clear">Clear</button>
      </div>`;
  }

  _colLabel(c) {
    return { target: 'Target', title: 'Title', message: 'Message', last_triggered: 'Last triggered', enabled: 'Enabled' }[c] || c;
  }

  // The right-cluster TYPE icon: the glyph reflects the SOURCE TYPE (blueprint
  // puzzle / script / template / automation). ONLY automations have an enable/
  // disable concept, so only they are colored green(enabled)/grey(disabled) and
  // are clickable to toggle. Scripts & template sensors are always-available, so
  // they get a neutral color and are static indicators.
  _typeStateIcon(g) {
    const glyph = g.isBlueprint ? 'mdi:puzzle' : (SOURCE_TYPES[g.sourceType] ? SOURCE_TYPES[g.sourceType].icon : 'mdi:bell');
    const typeLabel = g.isBlueprint ? 'Blueprint automation' : (SOURCE_TYPES[g.sourceType] ? SOURCE_TYPES[g.sourceType].label : 'Source');
    if (g.sourceType === 'automation') {
      const on = g.state === 'on';
      const cls = `anm-type-icon anm-type-${on ? 'on' : 'off'}`;
      const title = `${typeLabel} — ${on ? 'enabled, click to disable' : 'disabled, click to enable'}${g.isBlueprint ? ' · ' + escapeHtml(g.blueprintPath || '') : ''}`;
      return `<button class="${cls} anm-toggle" data-toggle-entity="${escapeHtml(g.entityId)}" data-toggle-state="${on ? 'on' : 'off'}" title="${title}"><ha-icon icon="${glyph}"></ha-icon></button>`;
    }
    // Scripts / template sensors: neutral (no enable/disable state).
    return `<span class="anm-type-icon anm-type-neutral" title="${typeLabel}"><ha-icon icon="${glyph}"></ha-icon></span>`;
  }

  _renderGroup(g) {
    const def = SOURCE_TYPES[g.sourceType];
    const open = this._isOpen(g.key);
    const visRows = this._visibleRows(g);

    // Right-side cluster: count chip, last-triggered, lock, TYPE ICON (state), open-in-HA.
    const rightBits = [];
    if (g.rows.length) rightBits.push(`<span class="anm-count-chip" title="${visRows.length}${visRows.length !== g.rows.length ? ' of ' + g.rows.length : ''} notification${g.rows.length === 1 ? '' : 's'}">${visRows.length}</span>`);
    rightBits.push(`<span class="anm-group-lt" data-lt-for="${escapeHtml(g.entityId)}" data-col="last_triggered">${g.lastTriggered ? formatRelativeTime(new Date(g.lastTriggered)) : ''}</span>`);
    if (!g.editable && !g.isBlueprint) rightBits.push(`<span class="anm-lock" title="${escapeHtml(g.error || 'Read-only')}"><ha-icon icon="mdi:lock"></ha-icon></span>`);
    // TYPE ICON: source-type glyph. Automations show enabled/disabled (green/grey,
    // clickable); scripts/templates are neutral (no enable/disable concept).
    rightBits.push(this._typeStateIcon(g));
    if (def.editUrl && g.configId) rightBits.push(`<button class="anm-open" data-open-type="${g.sourceType}" data-open-id="${escapeHtml(g.configId)}" title="Open in Home Assistant"><ha-icon icon="mdi:open-in-new"></ha-icon></button>`);

    let body;
    if (g.status === 'loading' || g.status === 'idle') {
      // While auto-scan is off (and not actively scanning), an unloaded group has
      // no details yet — prompt for a manual scan instead of a "Loading…" spinner.
      body = (this._config.disable_auto_scan && !this._isScanning())
        ? `<div class="anm-skeleton">Click 'Scan Now' to load details</div>`
        : `<div class="anm-skeleton">Loading config…</div>`;
    } else if (g.isBlueprint) {
      body = `<div class="anm-readonly-note">Built from blueprint <b>${escapeHtml(g.blueprintPath || '')}</b>. Its notifications are defined in the blueprint and can't be edited here — open the blueprint to change them.</div>`;
    } else if (!g.editable) {
      body = `<div class="anm-readonly-note">Defined in YAML/packages — read-only here.${g.error ? ' (' + escapeHtml(g.error) + ')' : ''}</div>`;
    } else if (!visRows.length) {
      body = `<div class="anm-readonly-note">No notifications match the current Display Settings.</div>`;
    } else {
      body = `
        <table class="anm-table">
          <thead><tr>
            <th data-col="target">Target</th>
            <th data-col="title">Title</th>
            <th data-col="message">Message</th>
            <th class="anm-actions-h"></th>
          </tr></thead>
          <tbody>${visRows.map(r => this._renderRow(r, g)).join('')}</tbody>
        </table>`;
    }
    // When expanded, show the entity id (the source's location/identifier) above the body.
    const entityLine = `<div class="anm-group-entity">${escapeHtml(g.entityId)}</div>`;
    return `
      <details class="anm-group" data-group-id="${escapeHtml(g.key)}"${open ? ' open' : ''}>
        <summary class="anm-group-sum">
          <span class="anm-group-name" style="font-size:${this._config.name_size || 14}px;font-weight:${this._config.name_weight || 400};">${escapeHtml(g.name)}</span>
          <span class="anm-group-right">${rightBits.join('')}</span>
        </summary>
        <div class="anm-group-body">${entityLine}${body}</div>
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
    const selected = this._selection && this._selection.has(r.rowId);

    if (!editing) {
      return `
        <tr class="anm-row${dirty}${selected ? ' anm-selected' : ''}" data-row-id="${escapeHtml(r.rowId)}">
          <td data-col="target">
            <input type="checkbox" class="anm-row-sel" data-row-id="${escapeHtml(r.rowId)}" title="Select for bulk actions"${selected ? ' checked' : ''}>
            <span class="anm-svc anm-svc-link" data-target="${escapeHtml(r.service || '')}" title="Show everything using ${escapeHtml(r.service || '')}">${escapeHtml(svcShort)}</span>${targetChip}
          </td>
          <td data-col="title"><span class="anm-cell-tpl" data-tpl-cell="${escapeHtml(r.rowId)}::title" data-tpl="${rawTitle}">${rawTitle || '<span class="anm-none">—</span>'}</span></td>
          <td data-col="message"><span class="anm-cell-tpl" data-tpl-cell="${escapeHtml(r.rowId)}::message" data-tpl="${rawMsg}">${rawMsg || '<span class="anm-none">—</span>'}</span></td>
          <td class="anm-actions">
            <button class="anm-btn-test" data-row-id="${escapeHtml(r.rowId)}" title="Send a test notification"><ha-icon icon="mdi:send"></ha-icon></button>
            <button class="anm-btn-edit" data-row-id="${escapeHtml(r.rowId)}" title="Edit">✎</button>
          </td>
        </tr>`;
    }
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
            <span class="anm-edit-actions-spacer"></span>
            <button class="anm-btn-dup" data-row-id="${escapeHtml(r.rowId)}" title="Duplicate this notification within the ${escapeHtml(SOURCE_TYPES[r.sourceType].label.toLowerCase())}">Duplicate</button>
            <button class="anm-btn-del" data-row-id="${escapeHtml(r.rowId)}" title="Delete this notification from the ${escapeHtml(SOURCE_TYPES[r.sourceType].label.toLowerCase())}">Delete</button>
          </div>
        </td>
      </tr>`;
  }

  _styles() {
    return `
      .anm-wrap { padding: 8px 10px 12px; }
      .anm-header { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: var(--primary-text-color,#e1e1e1); padding: 6px 4px 10px; }
      .anm-header-icon { --mdc-icon-size: 22px; color: var(--primary-color,#2196F3); flex: 0 0 auto; }
      .anm-header-title { flex: 1 1 auto; }
      .anm-toolbar { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px 10px; border-bottom: 1px solid var(--divider-color,#333); margin-bottom: 8px; }
      .anm-toolbar-main { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .anm-toolbar-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .anm-filter-tip-slot:empty { display: none; }
      .anm-filter-tip { color: var(--secondary-text-color,#777); font-size: 11px; font-style: italic; padding: 0 2px; line-height: 1.3; }
      .anm-toolbar input[type=text], .anm-toolbar select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); font-size: 12px; }
      .anm-f-name { min-width: 180px; flex: 1 1 180px; }
      .anm-chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--secondary-text-color,#aaa); cursor: pointer; }
      .anm-load { font-size: 11px; color: var(--secondary-text-color,#888); }
      .anm-refresh { background: transparent; border: 1px dashed var(--primary-color,#2196F3); color: var(--primary-color,#2196F3); border-radius: 6px; cursor: pointer; padding: 5px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
      .anm-refresh:hover { background: rgba(var(--rgb-primary-color,33,150,243),0.12); }
      .anm-last-scan { font-size: 11px; color: var(--secondary-text-color,#888); }
      .anm-refresh ha-icon { --mdc-icon-size: 16px; }
      .anm-scan-hint { color: var(--secondary-text-color,#888); font-size: 12px; padding: 0 2px 2px; line-height: 1.4; }
      .anm-scan-progress { display: flex; align-items: center; gap: 8px; }
      /* Styled section divider (gradient lines flanking a centered icon + label). */
      .anm-divider { display: flex; align-items: center; gap: 10px; margin: 6px 2px 10px; color: var(--primary-color,#2196F3); font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      .anm-divider::before, .anm-divider::after { content: ''; flex: 1; height: 2px; background: linear-gradient(to right, transparent, var(--primary-color,#2196F3)); opacity: 0.6; }
      .anm-divider::before { background: linear-gradient(to left, transparent, var(--primary-color,#2196F3)); }
      .anm-divider ha-icon { --mdc-icon-size: 20px; flex: 0 0 auto; }
      .anm-divider-label { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
      .anm-divider-count { color: var(--secondary-text-color,#aaa); font-weight: 400; }
      /* Paged sections (each page as a collapsible). */
      .anm-page-sec { border: 1px solid var(--divider-color,#3a3a3a); border-radius: 10px; background: rgba(255,255,255,0.01); overflow: hidden; }
      .anm-page-sec[open] { border-color: var(--primary-color,#2196F3); }
      .anm-page-sum { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; color: var(--primary-text-color,#e1e1e1); }
      .anm-page-sum::-webkit-details-marker { display: none; }
      .anm-page-sum::marker { content: ''; }
      .anm-page-chev { --mdc-icon-size: 18px; color: var(--secondary-text-color,#888); transition: transform 0.15s ease; flex: 0 0 auto; }
      .anm-page-sec[open] .anm-page-chev { transform: rotate(180deg); color: var(--primary-color,#2196F3); }
      .anm-page-body { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
      .anm-display, .anm-sort { border: 1px solid var(--divider-color,#3a3a3a); border-radius: 10px; background: rgba(255,255,255,0.015); }
      .anm-display[open], .anm-sort[open] { border-color: var(--primary-color,#2196F3); }
      .anm-display-sum { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 13px; font-weight: 600; color: var(--primary-text-color,#e1e1e1); }
      .anm-display-sum::-webkit-details-marker { display: none; }
      .anm-display-sum::marker { content: ''; }
      .anm-display-title { flex: 1 1 auto; }
      .anm-display-sum ha-icon { --mdc-icon-size: 18px; color: var(--primary-color,#2196F3); }
      .anm-display-chev { flex: 0 0 auto; color: var(--secondary-text-color,#888) !important; transition: transform 0.15s ease; }
      .anm-display[open] .anm-display-chev, .anm-sort[open] .anm-display-chev { transform: rotate(180deg); color: var(--primary-color,#2196F3) !important; }
      .anm-display-body { display: flex; flex-wrap: wrap; gap: 16px; padding: 4px 14px 12px; }
      .anm-sort-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 14px 12px; }
      .anm-sort-levels { display: flex; flex-direction: column; gap: 6px; }
      .anm-sort-row { display: flex; align-items: center; gap: 8px; }
      .anm-sort-lbl { font-size: 12px; color: var(--secondary-text-color,#888); min-width: 52px; }
      .anm-sort-row select { padding: 5px 8px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); font-size: 12px; }
      .anm-sort-del { background: transparent; border: none; color: var(--secondary-text-color,#888); cursor: pointer; display: inline-flex; padding: 2px; }
      .anm-sort-del:hover:not([disabled]) { color: var(--error-color,#f44336); }
      .anm-sort-del[disabled] { opacity: 0.35; cursor: default; }
      .anm-sort-del ha-icon { --mdc-icon-size: 15px; }
      .anm-sort-add { align-self: flex-start; background: transparent; border: 1px dashed var(--primary-color,#2196F3); color: var(--primary-color,#2196F3); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
      .anm-d-group { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
      .anm-d-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color,#888); }
      .anm-groups { display: flex; flex-direction: column; gap: 8px; }
      .anm-pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px 4px 2px; margin-top: 4px; }
      .anm-pg-info { font-size: 12px; color: var(--secondary-text-color,#888); }
      .anm-pg-prev, .anm-pg-next { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#ccc); border-radius: 6px; cursor: pointer; padding: 4px 8px; display: inline-flex; }
      .anm-pg-prev:hover:not([disabled]), .anm-pg-next:hover:not([disabled]) { border-color: var(--primary-color,#2196F3); color: var(--primary-color,#2196F3); }
      .anm-pg-prev[disabled], .anm-pg-next[disabled] { opacity: 0.35; cursor: default; }
      .anm-pg-prev ha-icon, .anm-pg-next ha-icon { --mdc-icon-size: 18px; }
      .anm-empty, .anm-skeleton, .anm-readonly-note { color: var(--secondary-text-color,#888); font-size: 13px; padding: 10px; }
      .anm-loading { display: flex; align-items: center; gap: 10px; color: var(--secondary-text-color,#888); font-size: 13px; padding: 18px 10px; }
      .anm-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--divider-color,#444); border-top-color: var(--primary-color,#2196F3); animation: anm-spin 0.8s linear infinite; flex: 0 0 auto; }
      @keyframes anm-spin { to { transform: rotate(360deg); } }
      .anm-group { border: 1px solid var(--divider-color,#3a3a3a); border-radius: 12px; background: rgba(255,255,255,0.015); overflow: hidden; }
      .anm-group[open] { border-color: var(--primary-color,#2196F3); }
      .anm-group-sum { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 14px; }
      .anm-group-sum::-webkit-details-marker { display: none; }
      .anm-group-name { color: var(--primary-text-color,#e1e1e1); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .anm-group-entity { font-family: var(--code-font-family,monospace); font-size: 11px; color: var(--secondary-text-color,#888); padding: 2px 8px 6px; }
      .anm-group-right { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; flex: 0 0 auto; }
      .anm-count-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: rgba(var(--rgb-primary-color,33,150,243),0.18); color: var(--primary-text-color,#e1e1e1); font-size: 11px; font-weight: 600; box-sizing: border-box; }
      .anm-group-lt { color: var(--secondary-text-color,#888); font-size: 11px; white-space: nowrap; }
      .anm-lock { color: var(--secondary-text-color,#888); display: inline-flex; }
      .anm-lock ha-icon { --mdc-icon-size: 15px; }
      /* Type icon = source type glyph, colored by enabled/disabled state. */
      .anm-type-icon { display: inline-flex; align-items: center; background: transparent; border: none; padding: 2px; border-radius: 6px; }
      .anm-type-icon ha-icon { --mdc-icon-size: 18px; }
      .anm-type-on { color: var(--success-color,#4caf50); }
      .anm-type-off { color: var(--disabled-text-color,#777); }
      .anm-type-neutral { color: var(--secondary-text-color,#9aa0a6); }
      button.anm-type-icon { cursor: pointer; }
      button.anm-type-icon:hover { background: rgba(var(--rgb-primary-color,33,150,243),0.18); }
      .anm-open { background: transparent; border: none; color: var(--secondary-text-color,#aaa); cursor: pointer; padding: 0; display: inline-flex; }
      .anm-open:hover { color: var(--primary-color,#2196F3); }
      .anm-open ha-icon { --mdc-icon-size: 16px; }
      .anm-group-body { padding: 0 8px 8px; }
      .anm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .anm-table th { text-align: left; color: var(--secondary-text-color,#888); font-weight: 600; font-size: 11px; padding: 4px 8px; border-bottom: 1px solid var(--divider-color,#333); }
      .anm-table td { padding: 6px 8px; vertical-align: top; border-bottom: 1px solid var(--divider-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); }
      .anm-row:hover td { background: rgba(255,255,255,0.02); }
      .anm-row.anm-dirty td { background: rgba(var(--rgb-primary-color,33,150,243),0.10); }
      .anm-svc { font-family: var(--code-font-family,monospace); }
      .anm-svc-link { cursor: pointer; }
      .anm-svc-link:hover { color: var(--primary-color,#2196F3); text-decoration: underline; }
      .anm-row-sel { margin-right: 6px; vertical-align: middle; }
      .anm-row.anm-selected td { background: rgba(var(--rgb-primary-color,33,150,243),0.08); }
      .anm-tchip { margin-left: 6px; font-size: 10px; padding: 1px 5px; border-radius: 999px; border: 1px solid var(--divider-color,#444); color: var(--secondary-text-color,#aaa); }
      .anm-cell-tpl { white-space: pre-wrap; word-break: break-word; }
      .anm-none { color: var(--secondary-text-color,#666); }
      .anm-tpl-pending { opacity: 0.6; }
      .anm-tpl-err { color: var(--error-color,#f44336); }
      .anm-actions, .anm-actions-h { width: 62px; text-align: right; white-space: nowrap; }
      .anm-btn-edit { background: transparent; border: none; color: var(--secondary-text-color,#aaa); cursor: pointer; font-size: 14px; padding: 2px 4px; }
      .anm-btn-edit:hover { color: var(--primary-text-color,#fff); }
      .anm-btn-test { background: transparent; border: none; color: var(--secondary-text-color,#aaa); cursor: pointer; padding: 2px 4px; display: inline-flex; vertical-align: middle; }
      .anm-btn-test:hover { color: var(--primary-color,#2196F3); }
      .anm-btn-test ha-icon { --mdc-icon-size: 15px; }
      .anm-selbar { display: flex; align-items: center; gap: 10px; padding: 6px 2px 0; }
      .anm-selbar-count { font-size: 12px; color: var(--primary-text-color,#e1e1e1); font-weight: 600; }
      .anm-selbar button { border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
      .anm-selbar-retarget { background: var(--primary-color,#2196F3); color: #fff; border: none; }
      .anm-selbar-test { background: transparent; border: 1px solid var(--primary-color,#2196F3); color: var(--primary-color,#2196F3); }
      .anm-selbar-enable { background: transparent; border: 1px solid var(--success-color,#4caf50); color: var(--success-color,#4caf50); }
      .anm-selbar-disable { background: transparent; border: 1px solid var(--warning-color,#ff9800); color: var(--warning-color,#ff9800); }
      .anm-selbar-clear { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#ccc); }
      .anm-editcell { background: rgba(var(--rgb-primary-color,33,150,243),0.06); }
      .anm-edit-grid { display: grid; grid-template-columns: 120px 1fr; gap: 8px 10px; align-items: center; padding: 6px 2px; }
      .anm-edit-grid label { font-size: 12px; color: var(--secondary-text-color,#aaa); }
      .anm-in { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color,#e1e1e1); font-size: 12px; }
      .anm-in-invalid { border-color: var(--error-color,#f44336); }
      .anm-in-msg, .anm-in-json { font-family: var(--code-font-family,monospace); resize: vertical; }
      .anm-edit-actions { display: flex; gap: 8px; align-items: center; padding: 8px 2px 4px; }
      .anm-edit-actions-spacer { flex: 1 1 auto; }
      .anm-btn-save { background: var(--primary-color,#2196F3); color: #fff; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
      .anm-btn-cancel { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#e1e1e1); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
      .anm-btn-dup { background: transparent; border: 1px solid var(--divider-color,#444); color: var(--primary-text-color,#ccc); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
      .anm-btn-del { background: transparent; border: 1px solid var(--error-color,#f44336); color: var(--error-color,#f44336); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
    `;
  }

  _applyColumnVisibility() {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) return;
    const cols = this._viewColumns || DEFAULT_COLUMNS;
    wrap.setAttribute('data-cols', cols.join(' '));
    let styleEl = this.querySelector('#anm-col-style');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'anm-col-style'; this.appendChild(styleEl); }
    const hidden = ALL_COLUMNS.filter(c => !cols.includes(c));
    styleEl.textContent = hidden.map(c => `.anm-groups [data-col="${c}"]{display:none;}`).join('');
  }

  // ------------------------------------------------------------------------
  // EVENT WIRING
  // ------------------------------------------------------------------------
  // Toolbar + Display-Settings handlers only (the group list is wired separately
  // in _renderGroupList once loading completes). Re-rendering the group list on a
  // filter/display change is safe here because the data is already loaded.
  _attachToolbarHandlers() {
    const root = this;
    const relist = () => { this._page = 0; if (this._loadComplete) this._renderGroupList(); };
    const nameEl = root.querySelector('.anm-f-name');
    if (nameEl) nameEl.addEventListener('input', () => this._onNameFilterChanged(nameEl.value));
    const tgtEl = root.querySelector('.anm-f-target');
    if (tgtEl) tgtEl.addEventListener('change', () => { this._viewFilters.target = tgtEl.value; relist(); });
    const liveEl = root.querySelector('.anm-live');
    if (liveEl) liveEl.addEventListener('change', () => {
      this._liveRender = liveEl.checked;
      if (this._liveRender) this._enableLiveRenderOpenGroups(); else this._disableLiveRender();
    });
    root.querySelectorAll('.anm-d').forEach(cb => cb.addEventListener('change', () => {
      this._viewDisplay[cb.getAttribute('data-d')] = cb.checked;
      relist();
    }));
    this._attachSortHandlers();
    root.querySelectorAll('.anm-col').forEach(cb => cb.addEventListener('change', () => {
      const c = cb.getAttribute('data-col');
      const set = new Set(this._viewColumns);
      if (cb.checked) set.add(c); else set.delete(c);
      this._viewColumns = ALL_COLUMNS.filter(x => set.has(x));
      this._applyColumnVisibility();
    }));
    const refEl = root.querySelector('.anm-refresh');
    if (refEl) refEl.addEventListener('click', () => this._refreshAll());
  }

  _attachGroupHandlers() {
    const root = this;
    root.querySelectorAll('.anm-group').forEach(d => {
      d.addEventListener('toggle', () => {
        const key = d.getAttribute('data-group-id');
        this._openState[key] = d.open;
        // Configs are all preloaded before the list renders, so opening a group
        // only manages its live-render subscriptions (lazy per group).
        if (d.open) { if (this._liveRender) this._subscribeCellsIn(d); }
        else { this._unsubscribeCellsIn(d); }
      });
    });
    root.querySelectorAll('.anm-open').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      this._openInHA(b.getAttribute('data-open-type'), b.getAttribute('data-open-id'));
    }));
    root.querySelectorAll('.anm-btn-edit').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onEdit(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-cancel').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onCancel(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-save').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onSave(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-dup').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onDuplicate(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-btn-del').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onDelete(b.getAttribute('data-row-id')); }));
    root.querySelectorAll('.anm-row.anm-editing').forEach(tr => {
      const rowId = tr.getAttribute('data-row-id');
      tr.querySelectorAll('.anm-in').forEach(inp => inp.addEventListener('input', () => this._onFieldInput(rowId, inp)));
    });
    // Test-fire
    root.querySelectorAll('.anm-btn-test').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this._onTestFire(b.getAttribute('data-row-id')); }));
    // Reverse lookup — click a service name to filter to everything using it.
    root.querySelectorAll('.anm-svc-link').forEach(s => s.addEventListener('click', (e) => {
      e.stopPropagation();
      this._viewFilters.target = s.getAttribute('data-target') || '';
      const sel = this.querySelector('.anm-f-target'); if (sel) sel.value = this._viewFilters.target;
      this._renderGroupList();
    }));
    // Row selection for bulk actions
    root.querySelectorAll('.anm-row-sel').forEach(cb => cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = cb.getAttribute('data-row-id');
      if (cb.checked) this._selection.add(id); else this._selection.delete(id);
      const tr = cb.closest('.anm-row'); if (tr) tr.classList.toggle('anm-selected', cb.checked);
      this._refreshSelectionBar();
    }));
    // Enable/disable the parent automation (state dot doubles as the toggle).
    root.querySelectorAll('.anm-toggle').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      this._onToggleAutomation(b.getAttribute('data-toggle-entity'), b.getAttribute('data-toggle-state'));
    }));
    this._attachSelectionBarHandlers();
  }

  // Selection-bar handlers (the bar lives in the toolbar area; re-wired whenever
  // it's re-rendered by _refreshSelectionBar).
  _attachSelectionBarHandlers() {
    const test = this.querySelector('.anm-selbar-test');
    if (test) test.addEventListener('click', () => this._onBulkTestFire());
    const en = this.querySelector('.anm-selbar-enable');
    if (en) en.addEventListener('click', () => this._onBulkToggleAutomations('turn_on'));
    const dis = this.querySelector('.anm-selbar-disable');
    if (dis) dis.addEventListener('click', () => this._onBulkToggleAutomations('turn_off'));
    const rt = this.querySelector('.anm-selbar-retarget');
    if (rt) rt.addEventListener('click', () => this._onBulkRetarget());
    const cl = this.querySelector('.anm-selbar-clear');
    if (cl) cl.addEventListener('click', () => { this._selection.clear(); this._renderGroupList(); this._refreshSelectionBar(); });
  }

  // Re-render just the selection bar in place (no list rebuild).
  _refreshSelectionBar() {
    const tb = this.querySelector('.anm-toolbar');
    if (!tb) return;
    let bar = tb.querySelector('.anm-selbar');
    const html = this._renderSelectionBar();
    if (bar) bar.remove();
    if (html) { tb.insertAdjacentHTML('beforeend', html); this._attachSelectionBarHandlers(); }
  }

  // Rebuild rows from cache and re-render the group list. Used after an edit/
  // save/cancel — the configs are already loaded, so this is a local update.
  _reflowGroups() {
    const wrap = this.querySelector('.anm-groups');
    if (!wrap) { this._rendered = false; this.renderCard(); this._rendered = true; return; }
    this._buildRows();
    this._renderGroupList();
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

  // Full re-scan: clear resolved cache entries and re-run the background load,
  // showing the progress line again and rebuilding the list once when done.
  _refreshAll() {
    this._fetchableItems().forEach(it => { const e = _cacheEntry(it.type, it.id); e.status = 'idle'; e.config = null; e.error = null; });
    this._loadComplete = false;
    this._scanRequested = true;   // pressing Scan Now always forces a scan, even if auto-scan is off
    this._page = 0;
    this._rendered = false;
    this.renderCard();
    this._rendered = true;
  }

  // Deep-link into HA's editor for this source.
  _openInHA(type, id) {
    const def = SOURCE_TYPES[type];
    if (!def || !def.editUrl || !id) return;
    const url = def.editUrl(id);
    try {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } catch (e) {
      try { window.location.assign(url); } catch (x) {}
    }
  }

  // ------------------------------------------------------------------------
  // EDIT / DIRTY / SAVE
  // ------------------------------------------------------------------------
  _onEdit(rowId) {
    const r = this._rowById(rowId);
    if (!r || !r.editable) return;
    r._edit = true;
    r._draft = { service: r.service, target: deepClone(r.target), title: r.title, message: r.message, data: deepClone(r.data) };
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
    const def = SOURCE_TYPES[r.sourceType];
    if (!hass || typeof hass.callApi !== 'function') { this._toast('Cannot save: hass.callApi unavailable.', true); return; }

    const dirtyRows = this._rows.filter(x => x.sourceType === r.sourceType && x.configId === r.configId && x._dirty && x._draft);

    // (Build B) Validate any {{ }} templates in the drafts before saving.
    const tplErrors = await this._validateDrafts(dirtyRows);

    // (Build B) Build a before→after diff of just the changed fields, per row.
    const diffHtml = this._renderSaveDiff(dirtyRows);
    let body = `This rewrites the ${def.label.toLowerCase()} "<b>${escapeHtml(r.name)}</b>" and reloads ${def.label.toLowerCase()}s. A live automation may re-trigger.`
      + diffHtml;
    if (tplErrors.length) {
      body += `<div style="margin-top:12px;padding:10px;border:1px solid var(--error-color,#f44336);border-radius:8px;background:rgba(244,67,54,0.12);color:var(--primary-text-color,#e1e1e1);font-size:12px;">⚠ ${tplErrors.length} template${tplErrors.length === 1 ? '' : 's'} failed to render:<br>${tplErrors.map(e => escapeHtml(e)).join('<br>')}<br><b>Save anyway?</b></div>`;
    }

    const confirmed = await this._confirmModal({
      title: 'Save notification change?',
      body,
      confirmLabel: tplErrors.length ? 'Save anyway & reload' : 'Save & reload',
      danger: true
    });
    if (!confirmed) return;

    try {
      const fresh = await hass.callApi('GET', def.configPath(r.configId));
      const clone = deepClone(fresh);
      for (const dr of dirtyRows) {
        const node = getAtPath(clone, dr.path);
        if (!node || !isNotifyCall(node)) {
          this._toast('Source changed elsewhere — reloading.', true);
          // Re-cache the fresh config we just fetched, then rebuild the list.
          const e = _cacheEntry(r.sourceType, r.configId);
          e.status = 'loaded'; e.config = clone; e.fetchedAt = Date.now();
          this._reflowGroups();
          return;
        }
        applyNotifyFields(node, dr._draft);
      }
      // (Build B) Stash the pre-write config for one-level Undo.
      this._stashUndo(r.sourceType, r.configId, r.name, deepClone(fresh));
      await hass.callApi('POST', def.configPath(r.configId), clone);
      if (def.reload) await hass.callService(def.reload[0], def.reload[1]).catch(() => {});

      const entry = _cacheEntry(r.sourceType, r.configId);
      entry.status = 'loaded'; entry.config = clone; entry.fetchedAt = Date.now();
      dirtyRows.forEach(dr => { dr._dirty = false; dr._edit = false; dr._draft = null; });
      this._buildRows();
      this._reflowGroups();
      this._toastUndo('Saved ✓');
    } catch (err) {
      this._toast('Save failed: ' + formatWsError(err), true);
    }
  }

  // ------------------------------------------------------------------------
  // BUILD B: template validation, save diff, undo
  // ------------------------------------------------------------------------

  // Render each draft's {{ }} title/message via a one-shot render_template; collect
  // human-readable errors. Non-template fields are skipped. Never throws.
  async _validateDrafts(dirtyRows) {
    const errs = [];
    const jobs = [];
    dirtyRows.forEach(dr => {
      ['title', 'message'].forEach(field => {
        const val = dr._draft && dr._draft[field];
        if (typeof val === 'string' && val.indexOf('{{') !== -1) {
          jobs.push(this._renderProbe(val).then(res => { if (res && res.error) errs.push(`${dr.name} · ${field}: ${res.error}`); }));
        }
      });
    });
    try { await Promise.all(jobs); } catch (e) {}
    return errs;
  }

  // One-shot render that resolves { result } or { error } (never rejects).
  _renderProbe(tpl) {
    const hass = this._hass;
    if (!hass || !hass.connection || typeof hass.connection.subscribeMessage !== 'function') return Promise.resolve({ result: tpl });
    return new Promise((resolve) => {
      let done = false, unsub = null;
      const finish = (v) => { if (done) return; done = true; if (unsub) { try { unsub(); } catch (e) {} } resolve(v); };
      let p;
      try {
        p = hass.connection.subscribeMessage(
          (msg) => { if (msg && msg.error) finish({ error: String(msg.error) }); else finish({ result: msg && msg.result != null ? String(msg.result) : '' }); },
          { type: 'render_template', template: tpl, report_errors: true });
      } catch (e) { resolve({ result: tpl }); return; }
      p.then(u => { unsub = u; if (done) { try { u(); } catch (e) {} } }).catch(err => finish({ error: formatWsError(err) }));
      setTimeout(() => finish({ result: tpl }), 3000);
    });
  }

  // Compact before→after of changed fields across the dirty rows for this source.
  // The confirm modal lives outside the card's <style> scope, so styles are inline.
  _renderSaveDiff(dirtyRows) {
    const rowCss = 'display:grid;grid-template-columns:64px 1fr auto 1fr;gap:6px;align-items:baseline;font-size:12px;margin:3px 0;';
    const kCss = 'color:var(--secondary-text-color,#888);';
    const bCss = 'color:var(--secondary-text-color,#aaa);text-decoration:line-through;word-break:break-word;';
    const aCss = 'color:var(--primary-text-color,#e1e1e1);word-break:break-word;';
    const arrCss = 'color:var(--primary-color,#2196F3);';
    const parts = [];
    dirtyRows.forEach(dr => {
      const cur = this._rows.find(x => x.rowId === dr.rowId) || {};
      const before = { service: cur.service, title: cur.title, message: cur.message, data: cur.data };
      const after = dr._draft;
      const rowChanges = [];
      [['service', 'Target'], ['title', 'Title'], ['message', 'Message']].forEach(([k, label]) => {
        const b = before[k] || '', a = after[k] || '';
        if (String(b) !== String(a)) rowChanges.push(`<div style="${rowCss}"><span style="${kCss}">${label}</span><span style="${bCss}">${escapeHtml(b) || '—'}</span><span style="${arrCss}">→</span><span style="${aCss}">${escapeHtml(a) || '—'}</span></div>`);
      });
      if (JSON.stringify(before.data || {}) !== JSON.stringify(after.data || {})) rowChanges.push(`<div style="${rowCss}"><span style="${kCss}">Options</span><span style="${bCss}">changed</span><span style="${arrCss}">→</span><span style="${aCss}">updated</span></div>`);
      if (rowChanges.length) parts.push(rowChanges.join(''));
    });
    if (!parts.length) return '';
    return `<div style="margin:12px 0 2px;padding:10px;border:1px solid var(--divider-color,#444);border-radius:8px;background:rgba(255,255,255,0.03);">${parts.join('<div style="height:1px;background:var(--divider-color,#333);margin:6px 0;"></div>')}</div>`;
  }

  _stashUndo(sourceType, configId, name, prevConfig) {
    this._lastWrite = { sourceType, configId, name, prevConfig };
  }

  async _onUndo() {
    const w = this._lastWrite;
    const hass = this._hass;
    if (!w || !hass || typeof hass.callApi !== 'function') return;
    const def = SOURCE_TYPES[w.sourceType];
    try {
      await hass.callApi('POST', def.configPath(w.configId), w.prevConfig);
      if (def.reload) await hass.callService(def.reload[0], def.reload[1]).catch(() => {});
      const e = _cacheEntry(w.sourceType, w.configId);
      e.status = 'loaded'; e.config = deepClone(w.prevConfig); e.fetchedAt = Date.now();
      this._lastWrite = null;
      this._buildRows();
      this._reflowGroups();
      this._toast('Reverted ✓', false);
    } catch (err) {
      this._toast('Undo failed: ' + formatWsError(err), true);
    }
  }

  // A success toast that also offers a one-click Undo of the last save.
  _toastUndo(msg) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 14px;border-radius:8px;font-size:13px;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.4);background:var(--success-color,#4caf50);display:flex;align-items:center;gap:12px;`;
    const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    const btn = document.createElement('button');
    btn.textContent = 'Undo';
    btn.style.cssText = 'background:rgba(255,255,255,0.25);border:none;color:#fff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;';
    btn.addEventListener('click', () => { if (el.parentNode) el.parentNode.removeChild(el); this._onUndo(); });
    el.appendChild(btn);
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
  }

  // Fetch fresh, verify the target notify node still lives at r.path, run mutate()
  // on its parent action array, POST + reload, and re-cache. Shared by duplicate
  // and delete. `mutate(arr, idx, node)` edits the array in place.
  async _mutateAction(r, mutate) {
    const hass = this._hass;
    const def = SOURCE_TYPES[r.sourceType];
    if (!hass || typeof hass.callApi !== 'function') { this._toast('Cannot edit: hass.callApi unavailable.', true); return false; }
    try {
      const fresh = await hass.callApi('GET', def.configPath(r.configId));
      const clone = deepClone(fresh);
      const node = getAtPath(clone, r.path);
      const slot = resolveArraySlot(clone, r.path);
      if (!node || !isNotifyCall(node) || !slot || slot.arr[slot.idx] !== node) {
        this._toast('Source changed elsewhere — reloading.', true);
        const e = _cacheEntry(r.sourceType, r.configId);
        e.status = 'loaded'; e.config = clone; e.fetchedAt = Date.now();
        this._reflowGroups();
        return false;
      }
      mutate(slot.arr, slot.idx, node);
      await hass.callApi('POST', def.configPath(r.configId), clone);
      if (def.reload) await hass.callService(def.reload[0], def.reload[1]).catch(() => {});
      const entry = _cacheEntry(r.sourceType, r.configId);
      entry.status = 'loaded'; entry.config = clone; entry.fetchedAt = Date.now();
      this._buildRows();
      this._reflowGroups();
      return true;
    } catch (err) {
      this._toast('Failed: ' + formatWsError(err), true);
      return false;
    }
  }

  // Duplicate a notification: insert a deep copy immediately after it in the same
  // action array. No confirm — additive and reversible via Delete.
  async _onDuplicate(rowId) {
    const r = this._rowById(rowId);
    if (!r || !r.editable) return;
    const ok = await this._mutateAction(r, (arr, idx, node) => {
      arr.splice(idx + 1, 0, deepClone(node));
    });
    if (ok) this._toast('Duplicated ✓', false);
  }

  // Delete a notification: splice it out of its action array. Destructive → confirm.
  async _onDelete(rowId) {
    const r = this._rowById(rowId);
    if (!r || !r.editable) return;
    const def = SOURCE_TYPES[r.sourceType];
    const label = def.label.toLowerCase();
    const confirmed = await this._confirmModal({
      title: 'Delete this notification?',
      body: `This permanently removes this <b>${escapeHtml(r.service || 'notify')}</b> action from the ${label} "<b>${escapeHtml(r.name)}</b>" and reloads ${label}s. Other actions and branches are left intact. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!confirmed) return;
    const ok = await this._mutateAction(r, (arr, idx) => {
      arr.splice(idx, 1);
    });
    if (ok) this._toast('Deleted ✓', false);
  }

  // ------------------------------------------------------------------------
  // CONTROL ACTIONS (Build A): test-fire, enable/disable, bulk retarget
  // ------------------------------------------------------------------------

  // Resolve a template string to its current value via a one-shot render_template
  // WS call (subscribe, take the first result, immediately unsubscribe).
  _renderOnce(tpl) {
    const hass = this._hass;
    if (!tpl || tpl.indexOf('{{') === -1) return Promise.resolve(tpl);
    if (!hass || !hass.connection || typeof hass.connection.subscribeMessage !== 'function') return Promise.resolve(tpl);
    return new Promise((resolve) => {
      let done = false, unsub = null;
      const finish = (v) => { if (done) return; done = true; if (unsub) { try { unsub(); } catch (e) {} } resolve(v); };
      let p;
      try {
        p = hass.connection.subscribeMessage(
          (msg) => { if (msg && msg.error) finish(tpl); else finish(msg && msg.result != null ? String(msg.result) : ''); },
          { type: 'render_template', template: tpl, report_errors: true });
      } catch (e) { resolve(tpl); return; }
      p.then(u => { unsub = u; if (done) { try { u(); } catch (e) {} } }).catch(() => finish(tpl));
      // Safety timeout — never hang the test-fire on a slow/broken template.
      setTimeout(() => finish(tpl), 3000);
    });
  }

  async _onTestFire(rowId) {
    const r = this._rowById(rowId);
    if (!r) return;
    const hass = this._hass;
    if (!hass || typeof hass.callService !== 'function') { this._toast('Cannot test: callService unavailable.', true); return; }
    const svc = r.service || '';
    if (svc.indexOf('notify.') !== 0) { this._toast('Not a notify service.', true); return; }
    const serviceName = svc.slice('notify.'.length);
    const hasTpl = (r.title && r.title.indexOf('{{') !== -1) || (r.message && r.message.indexOf('{{') !== -1);

    const confirmed = await this._confirmModal({
      title: 'Send a test notification?',
      body: `This sends a REAL notification now via <b>${escapeHtml(svc)}</b> to its device(s), using this notification's current title & message.${hasTpl ? ' Templates will be rendered to their current values.' : ''}`,
      confirmLabel: 'Send test',
      danger: false
    });
    if (!confirmed) return;

    try {
      await this._fireOne(r);
      this._toast('Test sent ✓', false);
    } catch (err) {
      this._toast('Test failed: ' + formatWsError(err), true);
    }
  }

  // Render this row's title/message templates and fire the notify service once.
  // Shared by single and bulk test-fire. Throws on callService failure.
  async _fireOne(r) {
    const serviceName = (r.service || '').slice('notify.'.length);
    const [title, message] = await Promise.all([this._renderOnce(r.title || ''), this._renderOnce(r.message || '')]);
    const data = {};
    if (title) data.title = title;
    data.message = message || '(test)';
    if (r.data && Object.keys(r.data).length) data.data = deepClone(r.data);
    if (r.target) data.target = deepClone(r.target);
    return this._hass.callService('notify', serviceName, data);
  }

  // Bulk test-fire: send a real test for every selected notify.* row.
  async _onBulkTestFire() {
    const rows = Array.from(this._selection || []).map(id => this._rowById(id))
      .filter(r => r && (r.service || '').indexOf('notify.') === 0);
    if (!rows.length) { this._toast('No notify notifications selected.', true); return; }
    const svcCount = new Set(rows.map(r => r.service)).size;
    const anyTpl = rows.some(r => (r.title && r.title.indexOf('{{') !== -1) || (r.message && r.message.indexOf('{{') !== -1));

    const confirmed = await this._confirmModal({
      title: `Send ${rows.length} test notification${rows.length === 1 ? '' : 's'}?`,
      body: `This sends <b>${rows.length}</b> REAL notification${rows.length === 1 ? '' : 's'} now across <b>${svcCount}</b> target${svcCount === 1 ? '' : 's'}, each using its current title & message.${anyTpl ? ' Templates will be rendered to their current values.' : ''}`,
      confirmLabel: 'Send tests',
      danger: false
    });
    if (!confirmed) return;

    let ok = 0, fail = 0;
    for (const r of rows) {
      try { await this._fireOne(r); ok++; } catch (e) { fail++; }
    }
    this._toast(fail ? `Sent ${ok}; ${fail} failed.` : `Sent ${ok} test${ok === 1 ? '' : 's'} ✓`, !!fail);
  }

  // Enable/disable the parent automation. Non-destructive + reversible → no confirm.
  async _onToggleAutomation(entityId, curState) {
    const hass = this._hass;
    if (!hass || typeof hass.callService !== 'function' || !entityId) return;
    const service = curState === 'on' ? 'turn_off' : 'turn_on';
    try {
      await hass.callService('automation', service, { entity_id: entityId });
      // Live state will arrive via hass push → updateStates patches the dot.
    } catch (err) {
      this._toast('Toggle failed: ' + formatWsError(err), true);
    }
  }

  // Bulk enable/disable the DISTINCT parent automations of the selection, in one
  // service call. Reversible → no confirm. Scripts in the selection are ignored.
  async _onBulkToggleAutomations(service) {
    const hass = this._hass;
    if (!hass || typeof hass.callService !== 'function') return;
    const ids = Array.from(new Set(
      Array.from(this._selection || []).map(id => this._rowById(id))
        .filter(r => r && r.sourceType === 'automation' && r.entityId)
        .map(r => r.entityId)
    ));
    if (!ids.length) { this._toast('No automations selected.', true); return; }
    try {
      await hass.callService('automation', service, { entity_id: ids });
      // Live states arrive via hass push → updateStates patches the dots.
      const verb = service === 'turn_on' ? 'Enabled' : 'Disabled';
      this._toast(`${verb} ${ids.length} automation${ids.length === 1 ? '' : 's'} ✓`, false);
    } catch (err) {
      this._toast('Bulk toggle failed: ' + formatWsError(err), true);
    }
  }

  // Bulk retarget: change the notify service of all selected rows to a new target,
  // coalesced into one POST per source (reuses the save write-back path).
  async _onBulkRetarget() {
    const ids = Array.from(this._selection || []);
    const rows = ids.map(id => this._rowById(id)).filter(r => r && r.editable);
    if (!rows.length) { this._toast('No editable notifications selected.', true); return; }
    const targets = this._allTargets();

    const newSvc = await this._promptRetarget(targets, rows.length);
    if (!newSvc) return;

    // Group selected rows by source.
    const bySource = {};
    rows.forEach(r => { const k = `${r.sourceType}:${r.configId}`; (bySource[k] = bySource[k] || []).push(r); });

    let okCount = 0, failSources = 0;
    for (const key of Object.keys(bySource)) {
      const group = bySource[key];
      const { sourceType, configId } = group[0];
      const def = SOURCE_TYPES[sourceType];
      try {
        const fresh = await this._hass.callApi('GET', def.configPath(configId));
        const clone = deepClone(fresh);
        let applied = 0;
        for (const r of group) {
          const node = getAtPath(clone, r.path);
          if (!node || !isNotifyCall(node)) continue;   // stale path — skip this one
          applyNotifyFields(node, { service: newSvc, target: r.target, title: r.title, message: r.message, data: r.data });
          applied++;
        }
        if (!applied) { failSources++; continue; }
        await this._hass.callApi('POST', def.configPath(configId), clone);
        if (def.reload) await this._hass.callService(def.reload[0], def.reload[1]).catch(() => {});
        const e = _cacheEntry(sourceType, configId);
        e.status = 'loaded'; e.config = clone; e.fetchedAt = Date.now();
        okCount += applied;
      } catch (err) {
        failSources++;
      }
    }
    this._selection.clear();
    this._buildRows();
    this._reflowGroups();
    this._refreshSelectionBar();
    this._toast(failSources ? `Retargeted ${okCount}; ${failSources} source(s) failed.` : `Retargeted ${okCount} notification${okCount === 1 ? '' : 's'} ✓`, !!failSources);
  }

  // Modal to pick/type a new notify target for bulk retarget. Resolves to the
  // full "notify.X" service string, or null on cancel/empty.
  _promptRetarget(targets, count) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Retarget ${count} notification${count === 1 ? '' : 's'}</div>
        <div style="font-size:13px;color:var(--secondary-text-color,#bbb);line-height:1.5;margin-bottom:14px;">Pick an existing target or type a new <code>notify.*</code> service. This rewrites each affected source and reloads it.</div>
        <select class="anm-rt-sel" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid var(--divider-color,#444);background:var(--secondary-background-color,#2a2a2a);color:var(--primary-text-color,#e1e1e1);font-size:13px;margin-bottom:8px;">
          <option value="">— pick a target —</option>
          ${targets.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t.replace('notify.', ''))}</option>`).join('')}
        </select>
        <input class="anm-rt-in" type="text" placeholder="or type: notify.my_target" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid var(--divider-color,#444);background:var(--secondary-background-color,#2a2a2a);color:var(--primary-text-color,#e1e1e1);font-size:13px;margin-bottom:16px;">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="anm-rt-cancel" style="padding:8px 14px;border:1px solid var(--divider-color,#444);border-radius:6px;background:transparent;color:var(--primary-text-color,#e1e1e1);cursor:pointer;font-size:13px;">Cancel</button>
          <button class="anm-rt-ok" style="padding:8px 16px;border:none;border-radius:6px;background:var(--primary-color,#2196F3);color:#fff;cursor:pointer;font-size:13px;">Retarget & reload</button>
        </div>`;
      const modal = this._showModal(wrap);
      const sel = wrap.querySelector('.anm-rt-sel');
      const inp = wrap.querySelector('.anm-rt-in');
      sel.addEventListener('change', () => { if (sel.value) inp.value = sel.value; });
      wrap.querySelector('.anm-rt-cancel').onclick = () => { modal.close(); resolve(null); };
      wrap.querySelector('.anm-rt-ok').onclick = () => {
        let v = (inp.value || sel.value || '').trim();
        if (v && v.indexOf('notify.') !== 0) v = 'notify.' + v;
        modal.close();
        resolve(v || null);
      };
    });
  }

  // ------------------------------------------------------------------------
  // MODAL
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
  // LIVE RENDER — per-cell render_template WS subscriptions, LAZY per group.
  // Only cells inside currently-OPEN groups are subscribed; opening a group
  // subscribes its cells, collapsing one unsubscribes them.
  // ------------------------------------------------------------------------
  _enableLiveRenderOpenGroups() {
    this._tpl.enabled = true;
    if (!this._canSubscribe()) return;
    this.querySelectorAll('.anm-group[open]').forEach(g => this._subscribeCellsIn(g));
  }

  _canSubscribe() {
    const hass = this._hass;
    return !!(hass && hass.connection && typeof hass.connection.subscribeMessage === 'function');
  }

  _subscribeCellsIn(containerEl) {
    if (!this._tpl.enabled || !this._canSubscribe() || !containerEl) return;
    containerEl.querySelectorAll('.anm-cell-tpl[data-tpl-cell]').forEach(el => {
      const key = el.getAttribute('data-tpl-cell');
      const tpl = el.getAttribute('data-tpl') || '';
      if (tpl.indexOf('{{') === -1) return;   // static text
      this._subscribeCell(key, tpl, el);
    });
  }

  _unsubscribeCellsIn(containerEl) {
    if (!containerEl) return;
    containerEl.querySelectorAll('.anm-cell-tpl[data-tpl-cell]').forEach(el => {
      this._unsubscribeCell(el.getAttribute('data-tpl-cell'));
    });
  }

  _subscribeCell(key, tpl, el) {
    const existing = this._tpl.subs.get(key);
    if (existing) {
      if (existing.template === tpl) return;
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
      if (cur === rec) rec.unsub = u; else { try { u(); } catch (e) {} }
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
    const el = this.querySelector(`.anm-cell-tpl[data-tpl-cell="${cssEscape(key)}"]`);
    if (el) { el.textContent = el.getAttribute('data-tpl') || ''; el.classList.remove('anm-tpl-pending', 'anm-tpl-err'); }
  }

  _disableLiveRender() {
    this._tpl.enabled = false;
    Array.from(this._tpl.subs.keys()).forEach(k => this._unsubscribeCell(k));
  }

  _teardownAllTpl() {
    Array.from(this._tpl.subs.keys()).forEach(k => this._unsubscribeCell(k));
  }

  // ------------------------------------------------------------------------
  // LIVE PATCH
  // ------------------------------------------------------------------------
  updateStates() {
    const hass = this._hass;
    if (!hass || !this._rendered) return;
    let stateChanged = false;
    (this._groups || []).forEach(g => {
      const st = hass.states[g.entityId];
      if (!st) return;
      if (st.state !== g.state) stateChanged = true;
      g.state = st.state;
      g.lastTriggered = st.attributes && st.attributes.last_triggered;
      const ltEl = this.querySelector(`.anm-group-lt[data-lt-for="${cssEscape(g.entityId)}"]`);
      if (ltEl) ltEl.textContent = g.lastTriggered ? formatRelativeTime(new Date(g.lastTriggered)) : '';
      // Patch the type-icon state color (+ toggle attr) in place.
      const iconEl = this.querySelector(`.anm-group[data-group-id="${cssEscape(g.key)}"] .anm-type-icon`);
      if (iconEl) {
        const on = g.state === 'on';
        iconEl.classList.toggle('anm-type-on', on);
        iconEl.classList.toggle('anm-type-off', !on);
        if (iconEl.hasAttribute('data-toggle-entity')) iconEl.setAttribute('data-toggle-state', on ? 'on' : 'off');
      }
    });
    const d = this._viewDisplay || DEFAULT_DISPLAY;
    if (this._loadComplete && stateChanged && (!d.state_on || !d.state_off)) {
      const editing = (this._rows || []).some(r => r._edit || r._dirty);
      if (!editing) this._renderGroupList();
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
    const d = c.display;
    const dchk = (k, label) => `<label class="anm-ed-check"><input type="checkbox" class="ed-d" data-d="${k}"${d[k] ? ' checked' : ''}> ${label}</label>`;
    this.innerHTML = `
      <div class="anm-ed">
        <style>${this._edStyles()}</style>

        <div class="anm-ed-header">
          <ha-icon icon="mdi:message-badge-outline"></ha-icon>
          <span class="anm-ed-title">Notification Manager Card</span>
          <span class="anm-ed-build">${BUILD_NUMBER}</span>
        </div>

        <details class="anm-ed-row" open>
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">Card Behavior</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Card title and overall behavior.</div>
            <label class="anm-ed-check"><input type="checkbox" id="ed-disable-autoscan"${c.disable_auto_scan ? ' checked' : ''}> Disable Auto-Scan on Card Load</label>
            <div class="anm-ed-subhint">When on, the card won't read your automation/script configs until you press <b>Scan Now</b>. Useful on large systems, or to avoid config-API calls every time the dashboard opens.</div>
            <div class="anm-ed-group-title">Header</div>
            <div class="anm-ed-field"><span>Title</span>
              <input id="ed-title" type="text" placeholder="Notifications" value="${escapeHtml(c.title || '')}">
            </div>
            <label class="anm-ed-check"><input type="checkbox" id="ed-show-header-icon"${c.show_header_icon ? ' checked' : ''}> Show a header icon (left of the title)</label>
            ${c.show_header_icon ? `<div class="anm-ed-field"><span>Header icon</span><input id="ed-header-icon" type="text" placeholder="mdi:bell-ring-outline" value="${escapeHtml(c.header_icon || '')}"></div>` : ''}
            <div class="anm-ed-field"><span>Divider text</span><input id="ed-divider-text" type="text" placeholder="e.g. Notifications" value="${escapeHtml(c.divider_text || '')}"></div>
            <div class="anm-ed-field"><span>Divider icon</span><input id="ed-divider-icon" type="text" placeholder="mdi:view-grid" value="${escapeHtml(c.divider_icon || '')}"></div>
            <div class="anm-ed-subhint">A styled divider (gradient lines flanking a centered icon + text) shown above the list. Leave <b>Divider text</b> blank for no divider.</div>
            <div class="anm-ed-group-title">Scanning &amp; pagination</div>
            <label class="anm-ed-check"><input type="checkbox" id="ed-show-lastscan"${c.show_last_scan ? ' checked' : ''}> Show “last scanned” time next to Scan Now</label>
            <div class="anm-ed-field"><span>Items per page</span>
              <input id="ed-page-size" type="number" min="0" max="200" step="1" value="${Number(c.page_size) || 0}">
            </div>
            <div class="anm-ed-subhint">Break the list into pages of this many sources (<b>0 = off</b>, one scrolling list). The scan still runs in the background across all sources; pagination just limits how many render at once, so large lists stay fast.</div>
            ${(Number(c.page_size) || 0) > 0 ? `<label class="anm-ed-check"><input type="checkbox" id="ed-paged-sections"${c.paged_sections ? ' checked' : ''}> Show each page as its own collapsible section</label>` : ''}
            <label class="anm-ed-check"><input type="checkbox" id="ed-groups-open"${c.groups_default_open ? ' checked' : ''}> Groups open by default</label>
            <div class="anm-ed-group-title">List item name</div>
            <div class="anm-ed-slider-row">
              <span>Name size (px)</span>
              <input id="ed-name-size" type="range" min="10" max="28" step="1" value="${Number(c.name_size) || 14}">
              <span class="anm-ed-slider-value" id="ed-name-size-val">${Number(c.name_size) || 14}</span>
            </div>
            <div class="anm-ed-field"><span>Name weight</span>
              <select id="ed-name-weight">
                ${[['400','Normal'],['500','Medium'],['600','Semibold'],['700','Bold']].map(([v,l]) => `<option value="${v}"${String(c.name_weight) === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="anm-ed-slider-row">
              <span>Min refresh (s)</span>
              <input id="ed-min-refresh" type="range" min="0" max="60" step="1" value="${Number(c.min_refresh_seconds) || 0}">
              <span class="anm-ed-slider-value" id="ed-min-refresh-val">${Number(c.min_refresh_seconds) || 0}</span>
            </div>
            <div class="anm-ed-subhint">How often the card refreshes live values (each automation's on/off dot and “last triggered” time). <b>0 = default</b> (near-instant, updates coalesced to ~250 ms). Raise to a few seconds only on large lists if the card feels busy — it caps those live updates to at most once every N seconds. It does <b>not</b> affect scanning or re-fetch notification text.</div>
          </div>
        </details>

        <details class="anm-ed-row">
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">List Defaults</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Starting Display Settings for the list of sources. Users can still change these live.</div>
            <div class="anm-ed-group-title">Show sources</div>
            ${dchk('show_native', 'Native Automations')}
            ${dchk('show_blueprint', 'Blueprint Automations')}
            ${dchk('show_scripts', 'Scripts')}
            ${dchk('show_template_sensors', 'Template Sensors')}
            <div class="anm-ed-group-title">Editability</div>
            ${dchk('editable', 'Editable')}
            ${dchk('not_editable', 'Not Editable')}
            <div class="anm-ed-group-title">Automation state</div>
            ${dchk('state_on', 'State = On')}
            ${dchk('state_off', 'State = Off')}
            <div class="anm-ed-group-title">Notifications</div>
            ${dchk('has_title', 'Has Title')}
            ${dchk('has_no_title', 'Has No Title')}
            <div class="anm-ed-group-title">Card panels</div>
            <label class="anm-ed-check"><input type="checkbox" id="ed-show-display"${c.show_display_panel ? ' checked' : ''}> Show the Display Settings panel on the card</label>
            <label class="anm-ed-check"><input type="checkbox" id="ed-show-sort"${c.show_sort_panel ? ' checked' : ''}> Show the Sort panel on the card</label>
            <label class="anm-ed-check"><input type="checkbox" id="ed-live"${c.live_render ? ' checked' : ''}> Live-render templates by default</label>
          </div>
        </details>

        <details class="anm-ed-row">
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">Sort Defaults</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Starting sort order. Add multiple levels to sort by more than one thing (first is primary, later levels break ties). Users can change this live from the Sort panel on the card.</div>
            <div class="anm-ed-sort-levels">${this._edSortLevels(c.sort)}</div>
            ${c.sort.length < SORT_KEYS.length ? `<button class="anm-ed-btn ed-sort-add" type="button">+ Add sort level</button>` : ''}
          </div>
        </details>

        <details class="anm-ed-row">
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">Detail Defaults</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Which table columns show by default.</div>
            ${ALL_COLUMNS.map(col => `<label class="anm-ed-check"><input type="checkbox" class="ed-col" data-col="${col}"${c.columns.includes(col) ? ' checked' : ''}> ${this._colLabel(col)}</label>`).join('')}
          </div>
        </details>

        <details class="anm-ed-row">
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">Filters</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Filtering by a target shows only sources that use it — still with all their nested notifications.</div>
            <div class="anm-ed-field"><span>Name contains</span><input id="ed-f-name" type="text" value="${escapeHtml(c.filters.automation || '')}"></div>
            <div class="anm-ed-field"><span>Target contains</span><input id="ed-f-target" type="text" value="${escapeHtml(c.filters.target || '')}"></div>
          </div>
        </details>

        <details class="anm-ed-row">
          <summary class="anm-ed-sum"><span class="anm-ed-sum-title">YAML preview</span><ha-icon class="anm-ed-chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="anm-ed-body">
            <div class="anm-ed-hint">Read-only. The card stores only view preferences — notifications live in your automations and scripts.</div>
            <pre class="anm-ed-yaml">${escapeHtml(toYaml(normalizeConfig(this._config)))}</pre>
          </div>
        </details>
      </div>
    `;
    this._rendered = true;
    this._attachEditorHandlers();
  }

  _colLabel(c) {
    return { target: 'Target', title: 'Title', message: 'Message', last_triggered: 'Last triggered', enabled: 'Enabled' }[c] || c;
  }

  // Editor: render the multi-level sort rows (mirrors the card-face panel).
  _edSortLevels(sort) {
    const levels = (Array.isArray(sort) && sort.length) ? sort : DEFAULT_SORT;
    const used = levels.map(l => l.by);
    return levels.map((lvl, i) => {
      const opts = SORT_KEYS.map(k => `<option value="${k}"${lvl.by === k ? ' selected' : ''}${(used.includes(k) && k !== lvl.by) ? ' disabled' : ''}>${SORT_LABELS[k]}</option>`).join('');
      return `<div class="anm-ed-sort-row" data-idx="${i}">
        <span class="anm-ed-sort-lbl">${i === 0 ? 'Sort by' : 'then by'}</span>
        <select class="ed-sort-by">${opts}</select>
        <select class="ed-sort-dir"><option value="asc"${lvl.dir === 'asc' ? ' selected' : ''}>Asc</option><option value="desc"${lvl.dir === 'desc' ? ' selected' : ''}>Desc</option></select>
        <button class="anm-ed-sort-del" type="button"${used.length <= 1 ? ' disabled' : ''}>✕</button>
      </div>`;
    }).join('');
  }

  _attachEditorHandlers() {
    const root = this;
    const set = (fn) => { fn(); this._fireConfigChanged(); this._refreshYaml(); };

    const titleEl = root.querySelector('#ed-title');
    if (titleEl) titleEl.addEventListener('input', () => set(() => { this._config.title = titleEl.value; }));

    root.querySelectorAll('.ed-d').forEach(cb => cb.addEventListener('change', () => set(() => {
      this._config.display[cb.getAttribute('data-d')] = cb.checked;
    })));

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
    bind('#ed-live', el => this._config.live_render = el.checked);
    bind('#ed-groups-open', el => this._config.groups_default_open = el.checked);
    bind('#ed-disable-autoscan', el => this._config.disable_auto_scan = el.checked);
    bind('#ed-name-weight', el => this._config.name_weight = Number(el.value) || 400);
    bind('#ed-show-display', el => this._config.show_display_panel = el.checked);
    bind('#ed-show-sort', el => this._config.show_sort_panel = el.checked);
    bind('#ed-show-lastscan', el => this._config.show_last_scan = el.checked);
    bind('#ed-header-icon', el => this._config.header_icon = el.value.trim() || 'mdi:bell-ring-outline');
    bind('#ed-divider-text', el => this._config.divider_text = el.value);
    bind('#ed-divider-icon', el => this._config.divider_icon = el.value.trim() || 'mdi:view-grid');
    bind('#ed-paged-sections', el => this._config.paged_sections = el.checked);

    // Multi-level sort defaults. Structural changes re-render the editor so the
    // disabled-options and row labels stay correct.
    const ensureSort = () => { if (!Array.isArray(this._config.sort) || !this._config.sort.length) this._config.sort = DEFAULT_SORT.map(l => ({ ...l })); return this._config.sort; };
    const rerender = () => { this._fireConfigChanged(); this._rendered = false; this.renderEditor(); };
    // Header-icon toggle reveals/hides the icon field → re-render editor.
    const shIcon = root.querySelector('#ed-show-header-icon');
    if (shIcon) shIcon.addEventListener('change', () => { this._config.show_header_icon = shIcon.checked; rerender(); });
    // Page-size change re-renders so the "paged sections" toggle appears/hides.
    const pgSize = root.querySelector('#ed-page-size');
    if (pgSize) pgSize.addEventListener('input', () => { this._config.page_size = Math.max(0, Math.min(200, Math.floor(Number(pgSize.value) || 0))); rerender(); });
    root.querySelectorAll('.anm-ed-sort-row').forEach(rowEl => {
      const idx = Number(rowEl.getAttribute('data-idx'));
      const by = rowEl.querySelector('.ed-sort-by');
      const dir = rowEl.querySelector('.ed-sort-dir');
      if (by) by.addEventListener('change', () => { const L = ensureSort(); if (L[idx]) L[idx].by = by.value; rerender(); });
      if (dir) dir.addEventListener('change', () => { const L = ensureSort(); if (L[idx]) L[idx].dir = dir.value; set(() => {}); });
      const del = rowEl.querySelector('.anm-ed-sort-del');
      if (del) del.addEventListener('click', () => { const L = ensureSort(); if (L.length <= 1) return; L.splice(idx, 1); rerender(); });
    });
    const sortAdd = root.querySelector('.ed-sort-add');
    if (sortAdd) sortAdd.addEventListener('click', () => { const L = ensureSort(); const unused = SORT_KEYS.find(k => !L.some(l => l.by === k)); if (!unused) return; L.push({ by: unused, dir: 'asc' }); rerender(); });

    const ns = root.querySelector('#ed-name-size');
    const nsVal = root.querySelector('#ed-name-size-val');
    if (ns) ns.addEventListener('input', () => set(() => { this._config.name_size = Number(ns.value) || 14; if (nsVal) nsVal.textContent = ns.value; }));

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
        .anm-ed-header { display: flex; align-items: center; gap: var(--ltek-sp-3); padding: 2px 2px 10px; border-bottom: 1px solid var(--ltek-c-border-soft); }
        .anm-ed-header ha-icon { --mdc-icon-size: 22px; color: var(--ltek-c-accent); }
        .anm-ed-title { font-size: var(--ltek-fs-header); font-weight: var(--ltek-fw-semibold); color: var(--ltek-c-text); }
        .anm-ed-build { margin-left: auto; font-size: var(--ltek-fs-small); color: var(--ltek-c-muted); font-family: var(--code-font-family, monospace); }
        /* Collapsible panel: a plain block (padding 0) — the summary carries the
           padding and the body gets its own. Matches the EES/Color panels so the
           summary height is identical (no extra flex-gap space under the title). */
        details.anm-ed-row {
          display: block;
          border: 1px solid var(--ltek-c-panel-border);
          border-radius: var(--ltek-r-panel);
          background: var(--ltek-c-surface);
        }
        details.anm-ed-row[open] { border-color: var(--ltek-c-accent); }
        .anm-ed-sum {
          list-style: none;
          cursor: pointer;
          user-select: none;
          display: flex; align-items: center; gap: var(--ltek-sp-3);
          padding: 10px 14px;
          font-size: var(--ltek-fs-panel-title);
          font-weight: var(--ltek-fw-bold);
          color: var(--ltek-c-text);
        }
        .anm-ed-sum::-webkit-details-marker { display: none; }
        .anm-ed-sum::marker { content: ''; }
        .anm-ed-sum .anm-ed-sum-title { flex: 1 1 auto; }
        .anm-ed-chev {
          --mdc-icon-size: var(--ltek-icon-lg); color: var(--ltek-c-muted); flex: 0 0 auto;
          transition: transform 0.15s ease;
        }
        details.anm-ed-row[open] .anm-ed-chev { transform: rotate(180deg); color: var(--ltek-c-accent); }
        /* Panel body: the settings live here, padded and stacked. */
        .anm-ed-body {
          display: flex; flex-direction: column; gap: var(--ltek-sp-4);
          padding: 0 14px 14px;
        }
        .anm-ed-hint { font-size: var(--ltek-fs-small); color: var(--ltek-c-muted); line-height: 1.45; }
        .anm-ed-subhint { font-size: var(--ltek-fs-small); color: var(--ltek-c-muted); line-height: 1.4; margin: -4px 0 2px; padding-left: 22px; }
        .anm-ed-subhint b { color: var(--ltek-c-label); font-weight: var(--ltek-fw-semibold); }
        .anm-ed-group-title { font-size: var(--ltek-fs-group); font-weight: var(--ltek-fw-bold); color: var(--ltek-c-accent); margin-top: var(--ltek-sp-1); padding-top: var(--ltek-sp-3); border-top: 1px solid var(--ltek-c-border-soft); }
        .anm-ed-body > .anm-ed-hint:first-of-type + .anm-ed-group-title { margin-top: 0; padding-top: 0; border-top: none; }
        .anm-ed-field { display: flex; align-items: center; gap: var(--ltek-sp-3); flex-wrap: wrap; }
        .anm-ed-field > span { font-size: var(--ltek-fs-label); color: var(--ltek-c-label); min-width: 130px; }
        .anm-ed-field input[type=text], .anm-ed-field select, .anm-ed input[type=text], .anm-ed select {
          flex: 1 1 180px; padding: var(--ltek-ctrl-pad);
          border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl);
          background: var(--secondary-background-color, #2a2a2a); color: var(--ltek-c-text);
          font-size: var(--ltek-fs-body);
        }
        .anm-ed-check { display: flex; align-items: center; gap: var(--ltek-sp-2); font-size: var(--ltek-fs-label); color: var(--ltek-c-label); cursor: pointer; }
        .anm-ed-slider-row { display: flex; align-items: center; gap: var(--ltek-sp-3); }
        .anm-ed-slider-row > span:first-child { font-size: var(--ltek-fs-label); color: var(--ltek-c-label); min-width: 130px; }
        .anm-ed-slider-row input[type=range] { flex: 1; }
        .anm-ed-slider-value { width: var(--ltek-slider-val-w); text-align: right; font-variant-numeric: tabular-nums; font-size: var(--ltek-fs-body); color: var(--ltek-c-text); }
        .anm-ed-yaml { margin: 0; padding: var(--ltek-sp-4); background: var(--secondary-background-color, #2a2a2a); border-radius: var(--ltek-r-md); font-family: var(--code-font-family, monospace); font-size: var(--ltek-fs-small); color: var(--ltek-c-text); white-space: pre-wrap; overflow-x: auto; }
        .anm-ed-sort-levels { display: flex; flex-direction: column; gap: var(--ltek-sp-2); }
        .anm-ed-sort-row { display: flex; align-items: center; gap: var(--ltek-sp-2); }
        .anm-ed-sort-lbl { font-size: var(--ltek-fs-label); color: var(--ltek-c-label); min-width: 56px; }
        .anm-ed-sort-row select { flex: 0 1 auto; padding: var(--ltek-ctrl-pad); border: 1px solid var(--ltek-c-border); border-radius: var(--ltek-r-ctrl); background: var(--secondary-background-color, #2a2a2a); color: var(--ltek-c-text); font-size: var(--ltek-fs-body); }
        .anm-ed-sort-del { background: transparent; border: none; color: var(--ltek-c-icon); cursor: pointer; font-size: 14px; padding: 2px 6px; }
        .anm-ed-sort-del:hover:not([disabled]) { color: var(--ltek-c-error); }
        .anm-ed-sort-del[disabled] { opacity: 0.35; cursor: default; }
        .anm-ed-btn { align-self: flex-start; background: transparent; border: 1px dashed var(--ltek-c-accent); color: var(--ltek-c-accent); border-radius: var(--ltek-r-ctrl); padding: 5px 12px; cursor: pointer; font-size: var(--ltek-fs-body); }
    `;
  }
}

// ============================================================================
// REGISTER CUSTOM ELEMENTS
// ============================================================================
console.log(`📦 Registering notification-manager-card custom elements... [${BUILD_NUMBER}]`);
customElements.define('notification-manager-card', ANMCard);
customElements.define('notification-manager-card-editor', ANMCardEditor);
console.log('[notification-manager-card] Loaded successfully -', BUILD_NUMBER);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'notification-manager-card',
  name: 'Notification Manager Card',
  description: 'Browse and edit every notify action embedded in your automations and scripts, grouped by source.',
});
