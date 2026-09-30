/* First-party usage for gpuism.com and local gpusim ui.
 * Beacons POST /usage/collect. GitHub Pages cannot store that POST; the same
 * events stay in localStorage so /usage/ can still show this browser.
 * No third-party tracker. No names, emails, IPs, query strings, or link hashes.
 * Keep event names and dwell buckets aligned with gpusim/usage.py. */
import { addEvent, loadStoredSummary, saveStoredSummary } from "./usage-report.js?v=cf4e787219-1759a639";

const HOSTS = new Set(["gpuism.com", "www.gpuism.com", "stefanopineda.github.io", "localhost", "127.0.0.1"]);
const SID_KEY = "gpusim-usage-sid";
const ENTRY_KEYS = ["start", "template", "demo", "net", "face", "view", "present"];
const COLLECT = "/usage/collect";

let surfaceOf = () => ({ inApp: false, phone: false, tab: "pc", view: "off", worth: false });
let started = false;
let lastTick = 0;
let acc = emptyAcc();
let queue = [];
let flushTimer = 0;

export function usageEnabled() {
  return HOSTS.has(location.hostname);
}

function emptyAcc() {
  return { ms: 0, pc: 0, customize: 0, worth: 0, resistor: 0, split: 0, case: 0, view_split: 0, network: 0 };
}

function sessionId() {
  try {
    let id = localStorage.getItem(SID_KEY);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function referrerOrigin() {
  if (!document.referrer) return "";
  try {
    const url = new URL(document.referrer);
    if (url.username || url.password) return "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function pageContext() {
  const params = new URLSearchParams(location.search);
  const props = {
    referrer: referrerOrigin(),
    vw: Math.round(window.innerWidth),
    vh: Math.round(window.innerHeight),
    lang: (navigator.language || "").slice(0, 16),
    device: window.matchMedia("(max-width: 800px)").matches ? "phone" : "desktop",
  };
  for (const key of ENTRY_KEYS) {
    const value = params.get(key);
    if (value && /^[A-Za-z0-9-]{1,64}$/.test(value)) props[key] = value;
  }
  return props;
}

function bucketsNow() {
  const surface = surfaceOf() || {};
  if (!surface.inApp) return [];
  if (surface.phone) {
    const tab = surface.tab === "network" ? "resistor" : surface.tab;
    return acc[tab] != null ? [tab] : ["pc"];
  }
  const view = surface.view === "split" ? "view_split" : surface.view === "full" ? "network" : "case";
  const keys = [view];
  if (surface.worth) keys.push("worth");
  return keys;
}

function accumulate() {
  const now = performance.now();
  if (!lastTick) lastTick = now;
  const slice = Math.min(20000, Math.max(0, now - lastTick));
  lastTick = now;
  if (document.visibilityState !== "visible" || !slice) return;
  acc.ms += slice;
  for (const key of bucketsNow()) acc[key] += slice;
}

function takeDwell() {
  if (acc.ms < 1) return null;
  const props = { ms: Math.round(acc.ms) };
  for (const key of Object.keys(acc)) {
    if (key !== "ms" && acc[key] >= 1) props[key] = Math.round(acc[key]);
  }
  acc = emptyAcc();
  return { sid: sessionId(), name: "dwell", props };
}

function remember(events) {
  try {
    const summary = loadStoredSummary();
    for (const event of events) addEvent(summary, event);
    saveStoredSummary(summary);
  } catch {
    /* private mode, or storage is full */
  }
}

function deliver(events, unload) {
  const body = JSON.stringify({ events });
  if (unload && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(COLLECT, blob)) return Promise.resolve();
  }
  return fetch(COLLECT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).then(
    () => {},
    () => {},
  );
}

export function flush(unload = false) {
  accumulate();
  const events = queue.splice(0, queue.length);
  const dwell = takeDwell();
  if (dwell) events.push(dwell);
  if (!events.length) return Promise.resolve();
  remember(events);
  return deliver(events, unload);
}

/** Close the current dwell slice before the app changes tab or view. */
export function touchSurface() {
  if (!started) return;
  accumulate();
}

export function track(name, props) {
  if (!usageEnabled()) return;
  queue.push({ sid: sessionId(), name, props: props || {} });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(false), 400);
}

function controlName(sel) {
  if (sel.dataset && sel.dataset.control) return sel.dataset.control.replace(/\s+/g, " ").trim().slice(0, 80);
  const label = sel.closest("label");
  if (!label) return "";
  const clone = label.cloneNode(true);
  clone.querySelectorAll("select, input, button").forEach((node) => node.remove());
  return clone.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
}

function onChange(ev) {
  const sel = ev.target;
  if (!sel || sel.tagName !== "SELECT") return;
  const value = String(sel.value || "").slice(0, 80);
  if (!value) return;
  const control = controlName(sel);
  if (!control) return;
  track("dropdown", { control, value });
  if (control === "Case") track("case", { case: value });
}

function onWorthClick(ev) {
  const row = ev.target.closest?.("[data-usage-worth]");
  if (!row) return;
  const button = ev.target.closest("button");
  let action = "row";
  const text = button ? button.textContent.trim() : "";
  if (text === "Apply") action = "apply";
  else if (text === "Undo") action = "undo";
  else if (text.startsWith("Test") || text.startsWith("Hide")) action = "test";
  track("worth", { id: row.getAttribute("data-usage-worth") || "", action });
}

export function installUsage(getSurface) {
  if (started || !usageEnabled()) return;
  started = true;
  if (typeof getSurface === "function") surfaceOf = getSurface;
  lastTick = performance.now();
  // Capture runs before the control's own handler, which re-renders the panel
  // and would detach the target before a bubble listener saw it.
  document.addEventListener("change", onChange, true);
  document.addEventListener("click", onWorthClick, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
    else lastTick = performance.now();
  });
  window.addEventListener("pagehide", () => flush(true));
  setInterval(() => {
    accumulate();
    if (acc.ms >= 10000) flush(false);
  }, 500);
  track("page_view", pageContext());
}
