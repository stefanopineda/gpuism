/* Totals page for first-party usage. The shapes match gpusim/usage.py.
 * This file does not start tracking. The app does that from usage.js. */

export const TOTALS_KEY = "gpusim-usage-totals";
export const BUCKETS = ["pc", "customize", "worth", "resistor", "split", "case", "view_split", "network"];

const PHONE_TABS = [
  ["pc", "PC"],
  ["customize", "Customize"],
  ["worth", "Worth it?"],
  ["resistor", "Resistor"],
  ["split", "Split"],
];
const DESKTOP_VIEWS = [
  ["case", "Case"],
  ["view_split", "Split"],
  ["network", "Network"],
];
const TAB_LABELS = {
  pc: "PC",
  customize: "Customize",
  worth: "Worth it?",
  resistor: "Resistor",
  split: "Split",
  case: "Case",
  view_split: "Split (desktop)",
  network: "Network",
};
const VIEW_LABELS = { front: "¾ front", side: "Side", rear: "¾ rear" };

export function emptySummary() {
  const dwell_tabs_ms = {};
  for (const key of BUCKETS) dwell_tabs_ms[key] = 0;
  return {
    source: "this-browser",
    page_views: 0,
    sessions: 0,
    dwell_ms: 0,
    dwell_tabs_ms,
    counts: { tab: 0, case: 0, preset: 0, dropdown: 0, worth: 0, view: 0, unit: 0, copy_link: 0, optimize: 0 },
    tabs: {},
    cases: {},
    presets: {},
    dropdowns: {},
    worth: {},
    views: {},
    units: {},
    referrers: {},
    devices: {},
    languages: {},
    viewports: {},
    countries: {},
    entry: {},
    _sids: [],
  };
}

function safeKey(key) {
  if (typeof key !== "string" || !key || key === "__proto__" || key === "constructor" || key === "prototype") return "";
  return key;
}

function bump(bucket, key) {
  key = safeKey(key);
  if (!key || !bucket) return;
  if (Object.prototype.hasOwnProperty.call(bucket, key)) bucket[key] += 1;
  else if (Object.keys(bucket).length < 40) bucket[key] = 1;
}

export function addEvent(summary, event) {
  if (!event || typeof event.name !== "string") return;
  const sid = typeof event.sid === "string" ? event.sid : "";
  if (sid) {
    if (!Array.isArray(summary._sids)) summary._sids = [];
    if (!summary._sids.includes(sid)) summary._sids.push(sid);
    summary.sessions = summary._sids.length;
  }
  const props = event.props && typeof event.props === "object" ? event.props : {};
  if (event.name === "page_view") {
    summary.page_views += 1;
    bump(summary.referrers, props.referrer || "(direct)");
    if (props.device === "phone" || props.device === "desktop") bump(summary.devices, props.device);
    if (typeof props.lang === "string") bump(summary.languages, props.lang);
    if (Number.isFinite(props.vw) && Number.isFinite(props.vh)) bump(summary.viewports, `${props.vw}x${props.vh}`);
    if (typeof props.country === "string") bump(summary.countries, props.country);
    for (const key of ["start", "template", "demo", "net", "face", "view", "present"]) {
      if (typeof props[key] === "string") {
        summary.entry[key] = summary.entry[key] || {};
        bump(summary.entry[key], props[key]);
      }
    }
    return;
  }
  if (event.name === "dwell") {
    summary.dwell_ms += Number(props.ms) || 0;
    for (const key of BUCKETS) summary.dwell_tabs_ms[key] += Number(props[key]) || 0;
    return;
  }
  if (summary.counts[event.name] != null) summary.counts[event.name] += 1;
  if (event.name === "tab") bump(summary.tabs, props.tab);
  else if (event.name === "case") bump(summary.cases, props.case);
  else if (event.name === "preset") bump(summary.presets, props.id);
  else if (event.name === "dropdown" && props.control && props.value) {
    if (!summary.dropdowns[props.control]) {
      if (Object.keys(summary.dropdowns).length >= 40) return;
      summary.dropdowns[props.control] = {};
    }
    bump(summary.dropdowns[props.control], props.value);
  } else if (event.name === "worth") bump(summary.worth, props.id);
  else if (event.name === "view") bump(summary.views, props.view);
  else if (event.name === "unit") bump(summary.units, props.unit);
}

export function publicSummary(summary) {
  const copy = JSON.parse(JSON.stringify(summary));
  delete copy._sids;
  return copy;
}

export function loadStoredSummary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOTALS_KEY) || "");
    if (!parsed || typeof parsed.page_views !== "number" || !parsed.dwell_tabs_ms) return emptySummary();
    const summary = emptySummary();
    summary.page_views = parsed.page_views || 0;
    summary.dwell_ms = parsed.dwell_ms || 0;
    for (const key of BUCKETS) summary.dwell_tabs_ms[key] = Number(parsed.dwell_tabs_ms[key]) || 0;
    for (const key of Object.keys(summary.counts)) summary.counts[key] = Number(parsed.counts?.[key]) || 0;
    for (const key of ["tabs", "cases", "presets", "dropdowns", "worth", "views", "units", "referrers", "devices", "languages", "viewports", "countries", "entry"]) {
      if (parsed[key] && typeof parsed[key] === "object") summary[key] = parsed[key];
    }
    if (Array.isArray(parsed._sids)) summary._sids = parsed._sids.filter((id) => typeof id === "string").slice(0, 200);
    summary.sessions = summary._sids.length;
    summary.source = "this-browser";
    return summary;
  } catch {
    return emptySummary();
  }
}

export function saveStoredSummary(summary) {
  localStorage.setItem(TOTALS_KEY, JSON.stringify(summary));
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function sorted(obj) {
  return Object.entries(obj || {}).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function table(pairs, labelOf = (key) => key) {
  if (!pairs.length) return `<p class="fine">None yet.</p>`;
  const rows = pairs
    .map(([key, count]) => `<tr><td>${escapeHtml(labelOf(key))}</td><td>${escapeHtml(String(count))}</td></tr>`)
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function dwellTable(summary, rows) {
  const body = rows
    .map(([key, label]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(formatDuration(summary.dwell_tabs_ms[key] || 0))}</td></tr>`)
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

function dropdownTable(dropdowns) {
  const controls = sorted(Object.fromEntries(Object.entries(dropdowns || {}).map(([key, values]) => [key, Object.values(values).reduce((s, n) => s + n, 0)])));
  if (!controls.length) return `<p class="fine">None yet.</p>`;
  const chunks = controls.map(([control]) => {
    const values = sorted(dropdowns[control]).map(([value, count]) => `<li>${escapeHtml(value)} <span>${count}</span></li>`).join("");
    return `<h3>${escapeHtml(control)}</h3><ul class="counts">${values}</ul>`;
  });
  return chunks.join("");
}

function renderSummary(summary) {
  const counts = summary.counts || {};
  const countries = sorted(summary.countries);
  return `
    <section>
      <h2>Visit</h2>
      <table><tbody>
        <tr><td>Page views</td><td>${summary.page_views || 0}</td></tr>
        <tr><td>Sessions</td><td>${summary.sessions || 0}</td></tr>
        <tr><td>Time on site</td><td>${escapeHtml(formatDuration(summary.dwell_ms || 0))}</td></tr>
      </tbody></table>
    </section>
    <section>
      <h2>Time on each tab</h2>
      <h3>Phone</h3>
      ${dwellTable(summary, PHONE_TABS)}
      <h3>Desktop Case / Split / Network</h3>
      ${dwellTable(summary, DESKTOP_VIEWS)}
      <p class="fine">On a desktop, Worth it? is counted in the phone-tab row of that name while that panel is open, and also in Case, Split, or Network. Time on site is the visit length. It is not the sum of these rows. Phone Split and desktop Split are separate rows.</p>
    </section>
    <section>
      <h2>Actions</h2>
      <table><tbody>
        <tr><td>Tab changes</td><td>${counts.tab || 0}</td></tr>
        <tr><td>Case selections</td><td>${counts.case || 0}</td></tr>
        <tr><td>Preset / template picks</td><td>${counts.preset || 0}</td></tr>
        <tr><td>Dropdown changes</td><td>${counts.dropdown || 0}</td></tr>
        <tr><td>Worth it? row clicks</td><td>${counts.worth || 0}</td></tr>
        <tr><td>View buttons</td><td>${counts.view || 0}</td></tr>
        <tr><td>Unit toggle</td><td>${counts.unit || 0}</td></tr>
        <tr><td>Copy link</td><td>${counts.copy_link || 0}</td></tr>
        <tr><td>Optimize</td><td>${counts.optimize || 0}</td></tr>
      </tbody></table>
      <h3>Tabs</h3>
      ${table(sorted(summary.tabs), (key) => TAB_LABELS[key] || key)}
      <h3>Cases</h3>
      ${table(sorted(summary.cases))}
      <h3>Presets and templates</h3>
      ${table(sorted(summary.presets))}
      <h3>Dropdowns</h3>
      ${dropdownTable(summary.dropdowns)}
      <h3>Worth it? rows</h3>
      ${table(sorted(summary.worth))}
      <h3>Camera</h3>
      ${table(sorted(summary.views), (key) => VIEW_LABELS[key] || key)}
      <h3>Units</h3>
      ${table(sorted(summary.units), (key) => (key === "F" ? "°F" : key === "C" ? "°C" : key))}
    </section>
    <section>
      <h2>Arrival</h2>
      <h3>Referrer</h3>
      ${table(sorted(summary.referrers), (key) => (key === "" ? "(direct)" : key))}
      <h3>Device</h3>
      ${table(sorted(summary.devices))}
      <h3>Language</h3>
      ${table(sorted(summary.languages))}
      <h3>Viewport</h3>
      ${table(sorted(summary.viewports))}
      <h3>Country</h3>
      ${countries.length ? table(countries) : `<p class="fine">No country code. A country is stored only when the host already sent a two-letter header such as CF-IPCountry. GitHub Pages does not send one. This page does not call a geolocation service, and it does not store IP addresses.</p>`}
      <h3>Known link flags</h3>
      ${Object.keys(summary.entry || {}).length ? Object.entries(summary.entry).map(([key, values]) => `<h3>${escapeHtml(key)}</h3>${table(sorted(values))}`).join("") : `<p class="fine">None. Only start, template, demo, net, face, view, and present are kept, and only when the value is a short id. The rest of the query string and the whole link hash are dropped.</p>`}
    </section>`;
}

function howToRead(server) {
  const log = server && server.log ? server.log : "usage/events.jsonl";
  return `
    <section class="how">
      <h2>How to read this</h2>
      <p>The beacon is <code>POST /usage/collect</code> on the same origin. The browser sends page views, dwell, and the clicks listed above. A random session id is kept in localStorage under <code>gpusim-usage-sid</code>. Names, email addresses, IP addresses, and full query strings are not collected.</p>
      <p>On <code>gpusim ui</code>, events are appended to <code>${escapeHtml(log)}</code> in the directory where you started the server (override with <code>GPUSIM_USAGE_LOG</code>). Open <a href="/usage/summary.json">/usage/summary.json</a>, <a href="/usage/events.jsonl">/usage/events.jsonl</a>, or run <code>gpusim usage</code>.</p>
      <p>GitHub Pages cannot run that endpoint and cannot append a log. A visit to gpuism.com is recorded in this browser, and this page reads it back from localStorage. The publish workflow leaves an existing <code>usage/events.jsonl</code> on the Pages repo in place and this page will total that file if it is there. The deploy does not write visitor beacons into that file. A file left on Pages is public, so it stays free of names, emails, and query strings.</p>
      <p>The tracker runs only on gpuism.com, www.gpuism.com, stefanopineda.github.io, and local <code>gpusim ui</code>.</p>
    </section>`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) return null;
  return res.json();
}

async function fetchEvents(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim() || text.trim().startsWith("<")) return null;
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip a damaged line */
    }
  }
  if (!events.length) return null;
  const summary = emptySummary();
  for (const event of events) addEvent(summary, event);
  const out = publicSummary(summary);
  out.source = "events-file";
  return out;
}

function sourceTitle(summary) {
  if (summary.source === "server") return "Totals on this server";
  if (summary.source === "events-file") return "Totals from usage/events.jsonl";
  return "Totals in this browser";
}

export async function renderUsage(root) {
  const local = loadStoredSummary();
  let primary = null;
  for (const url of ["/usage/summary.json", "summary.json"]) {
    try {
      const data = await fetchJson(url);
      if (data && data.source === "server" && typeof data.page_views === "number") {
        primary = data;
        break;
      }
    } catch {
      /* static host, or the file is not JSON */
    }
  }
  if (!primary) {
    for (const url of ["/usage/events.jsonl", "events.jsonl"]) {
      try {
        primary = await fetchEvents(url);
        if (primary) break;
      } catch {
        /* no events file */
      }
    }
  }
  if (!primary) primary = publicSummary(local);
  const localNote =
    primary.source !== "this-browser" && local.page_views
      ? `<p class="fine">This browser has also recorded ${local.page_views} page view${local.page_views === 1 ? "" : "s"} and ${formatDuration(local.dwell_ms)} locally.</p>`
      : "";
  root.innerHTML = `
    <p class="eyebrow">gpuism usage</p>
    <h1>${escapeHtml(sourceTitle(primary))}</h1>
    <p class="lede"><a href="/">Back to the model</a></p>
    ${localNote}
    ${renderSummary(primary)}
    ${howToRead(primary.source === "server" ? primary : null)}`;
}

if (document.getElementById("usage-root")) {
  renderUsage(document.getElementById("usage-root"));
}
