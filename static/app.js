/* gpusim visualizer. Locally the solver is the Python server. On gpuism.com
 * the same calls are answered in the browser. This file drives the controls
 * and hands results to the 3D scene and the network view.
 * Rev 4.1: keep it simple. Every panel shows the one choice most people make;
 * everything else sits behind an expander. */
import { CaseScene, activeLayouts, faceFanLabel, facePatterns } from "./scene.js";
import { renderNetwork } from "./network.js";
import { SEAL_TEXT, TIPS, installTips } from "./tips.js";

const FACES = ["front", "top", "rear", "bottom", "side"];
const RADIATOR_FACES = ["front", "top", "bottom"];
const SEAL_FOR_FACE = { front: "front", top: "top", bottom: "bottom", side: "side", rear: "rear_slots" };
const FILTER_FACES = ["front", "top", "bottom"];
const DEFAULT_SEALS = { front: 3, top: 3, bottom: 4, side: 5, seams: 4, rear_slots: 3 };
const QUICK = { mike: "mike-bradley-dengen-x-station", meshify: "meshify2xl-stefano" };

const state = {
  presets: null,
  build: null,
  solution: null,
  compare: null,
  face: "case",
  selectedMount: null,
  unitF: false,
  demo: null,
  demoTimer: null,
  net: "off",
  scene: null,
  mtab: "pc",
  mtabChosen: false,
};

const $ = (id) => document.getElementById(id);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === "class") node.className = v;
    else if (k === "tip") node.setAttribute("data-tip", v);
    else if (k.startsWith("on")) node[k] = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = v;
    else if (k === "open") node.open = v;
    else node.setAttribute(k, v === true ? "" : v);
  });
  kids.flat().forEach((kid) => kid != null && kid !== "" && node.append(kid.nodeType ? kid : document.createTextNode(String(kid))));
  return node;
};

function fmt(c) {
  if (c == null || Number.isNaN(c)) return "—";
  if (state.unitF) return `${((c * 9) / 5 + 32).toFixed(1)} °F`;
  return `${c.toFixed(1)} °C`;
}

function tempColor(c) {
  const t = Math.max(55, Math.min(100, c ?? 70));
  const stops = [
    [55, [61, 122, 219]],
    [75, [90, 168, 112]],
    [85, [224, 161, 90]],
    [100, [226, 75, 59]],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
  const [t0, a] = stops[i];
  const [t1, b] = stops[i + 1];
  const u = (t - t0) / (t1 - t0 || 1);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(",")})`;
}

const caseOf = () => state.presets.cases.find((c) => c.id === state.build.case);
const cardOf = (id) => state.presets.cards.find((c) => c.id === id);
const fanOf = (id) => state.presets.fans.find((f) => f.id === id);
const isVertical = (slot) => String(slot).toLowerCase().startsWith("v");

/* GPUs in display order: horizontal cards top to bottom, then vertical ones. */
function orderedGpus() {
  return [...state.build.gpus].sort((a, b) => {
    const va = isVertical(a.slot);
    const vb = isVertical(b.slot);
    if (va !== vb) return va ? 1 : -1;
    return String(a.slot).localeCompare(String(b.slot), undefined, { numeric: true });
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  installTips($("tip"));
  state.presets = await (await fetch("/api/presets")).json();
  applyStaticTips();
  buildStartScreen();
  $("home").onclick = () => {
    stopDemo();
    $("app").classList.add("hidden");
    $("start").classList.remove("hidden");
  };
  document.querySelectorAll("#facebar button").forEach((b) => (b.onclick = () => setFace(b.dataset.face)));
  document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  document.querySelectorAll("[data-net]").forEach((b) => (b.onclick = () => setNet(b.dataset.net)));
  document.querySelectorAll("[data-mtab]").forEach((b) => (b.onclick = () => setMobileTab(b.dataset.mtab)));
  syncMobileChrome();
  window.matchMedia("(max-width: 800px)").addEventListener("change", syncMobileChrome);
  $("unit-toggle").onclick = () => {
    state.unitF = !state.unitF;
    $("unit-toggle").textContent = state.unitF ? "°C" : "°F";
    renderResults();
  };
  $("present-toggle").onclick = () => document.body.classList.toggle("present");
  $("compare-toggle").onclick = toggleCompare;
  $("demo-toggle").onclick = () => startDemo();
  $("demo-next").onclick = () => stepDemo(1);
  $("demo-prev").onclick = () => stepDemo(-1);
  $("demo-close").onclick = stopDemo;
  $("demo-auto").onchange = syncDemoTimer;
  $("opt-run").onclick = runOptimal;
  window.addEventListener("keydown", onKey);

  const params = new URLSearchParams(location.search);
  if (params.get("net")) setNet(params.get("net"), true);
  if (params.get("face")) state.face = params.get("face");
  if (params.get("present") === "1") document.body.classList.add("present");
  const start = params.get("start");
  const template = params.get("template");
  const demo = params.get("demo");
  let pending = null;
  if (demo === "mike-bradley" || demo === "mike") pending = loadBuild(QUICK.mike).then(() => startDemo("mike-bradley-demo"));
  else if (demo === "stefano") pending = loadBuild(QUICK.meshify).then(() => startDemo("stefano-demo"));
  else if (template) pending = loadBuild(template);
  else if (start === "meshify") pending = loadBuild(QUICK.meshify);
  else if (start === "9000") pending = loadBuild("corsair-9000d-sample");
  else if (start === "mike" || start === "mock") pending = loadBuild(QUICK.mike);
  if (pending && demo === "1") pending.then(() => startDemo());
  if (pending && params.get("view")) pending.then(() => setView(params.get("view")));
}

function applyStaticTips() {
  const legend = $("legend").querySelectorAll("span");
  [TIPS.legendIntake, TIPS.legendExhaust, TIPS.legendBlank, TIPS.legendGpu].forEach((t, i) => legend[i]?.setAttribute("data-tip", t));
  $("pressure-readout").dataset.tip = TIPS.casePa;
  $("ambient-readout").dataset.tip = TIPS.ambient;
  document.querySelector("[data-view]").parentElement.dataset.tip = TIPS.view;
  $("net-seg").dataset.tip = TIPS.network;
  $("opt-run").dataset.tip = TIPS.optimize;
  $("compare-toggle").dataset.tip = TIPS.compare;
  $("demo-toggle").dataset.tip = TIPS.demo;
  $("present-toggle").dataset.tip = TIPS.present;
  $("unit-toggle").dataset.tip = "Display in Fahrenheit or Celsius. The model always works in Celsius.";
}

function buildStartScreen() {
  const mike = state.presets.builds.find((b) => b.id === QUICK.mike);
  if (mike) $("quick-mike-name").textContent = mike.name.split(" — ")[0];
  $("quick-mike").onclick = () => loadBuild(QUICK.mike);
  $("quick-meshify").onclick = () => loadBuild(QUICK.meshify);
  const grid = $("template-grid");
  grid.innerHTML = "";
  const order = ["corsair-9000d-sample", "generic-atx-sample", "generic-matx-sample", "generic-eatx-sample", "phanteks-enthoo-sample"];
  order
    .map((id) => state.presets.builds.find((b) => b.id === id))
    .filter(Boolean)
    .forEach((b) => {
      const kase = state.presets.cases.find((c) => c.id === b.case);
      grid.append(
        el("button", { type: "button", onclick: () => loadBuild(b.id), tip: b.notes }, el("b", {}, b.name), el("span", {}, `${kase ? kase.name : b.case} · ${kase ? kase.horizontal_slots : "?"} slots`)),
      );
    });
  const sel = $("scratch-case");
  sel.innerHTML = "";
  state.presets.cases.forEach((c) => sel.append(el("option", { value: c.id }, c.name)));
  sel.value = "generic-atx";
  $("from-scratch").onclick = () => scratch(sel.value);
}

async function loadBuild(id) {
  const res = await fetch(`/api/build/${id}`);
  if (!res.ok) {
    // Usually a server started before this build preset existed: the page is
    // newer than the process serving it. Say so instead of drawing nothing.
    showLoadError(
      window.GPUSIM_BROWSER
        ? `Build "${id}" failed to load (HTTP ${res.status}). Reload the page and try again.`
        : `Build "${id}" is not on this server (HTTP ${res.status}). The gpusim ui process is older than this page — ` +
            "restart it (Ctrl-C, then `uv run gpusim ui`) and reload.",
    );
    return;
  }
  state.build = await res.json();
  state.gaps = null;
  state.notice = null;
  enterApp();
  await solveNow();
}

function showLoadError(text) {
  let box = document.getElementById("load-error");
  if (!box) {
    box = document.createElement("div");
    box.id = "load-error";
    box.className = "load-error";
    document.body.append(box);
  }
  box.textContent = text;
  box.classList.remove("hidden");
  box.onclick = () => box.classList.add("hidden");
}

function scratch(caseId) {
  const kase = state.presets.cases.find((c) => c.id === caseId);
  state.build = {
    id: "scratch",
    name: `From scratch · ${kase.name}`,
    case: caseId,
    ambient_c: 25,
    altitude_m: 0,
    gpus: [gpuTemplate("gpu1", "1", "rtx-pro-6000-blackwell-maxq")],
    mounts: kase.mounts.map((m) => ({ id: m.id, panel: m.panel, size_mm: m.size_mm, fan: null, state: "blanked", direction: "intake", duty: 1 })),
    radiator: { model: null, panel: "top", direction: "exhaust", arrangement: "push", fan: "generic-120", fan_count: 3, fan_duty: 1 },
    cpu: { power_w: 150, cooling: "air", cooler_fan: "generic-140", cooler_fans: "both", cooler_airflow: "up", cooler_duty: 0.8 },
    shroud: { mode: "off", fan: "noctua-nf-a14-ippc-3000", count: 2, duty: 1 },
    seals: { ...DEFAULT_SEALS },
    filters: { front: "fine" },
    patterns: {},
    obstruction: "low",
    cables: "clean",
    psu_location: "bottom_shroud",
    psu_fan: "down",
    drive_cage: "removed",
    side_panel: kase.side_panel === "mesh" ? "mesh" : "tempered_glass",
    brackets_removed: false,
    room_reingestion_c: 0,
    buoyancy: false,
    open_air: false,
    illustrative_mock: false,
    notes: "",
  };
  state.face = "case";
  state.gaps = null;
  enterApp();
  solveNow();
}

function gpuTemplate(id, slot, card) {
  const c = cardOf(card);
  return {
    id, slot, card, fan_curve: "stock", custom_curve: null,
    power_limit_w: c ? c.tbp_w : 300, memory_clock_offset_mhz: 0, core_clock_offset_mhz: 0, undervolt_mv: 0,
  };
}

function enterApp() {
  $("start").classList.add("hidden");
  $("app").classList.remove("hidden");
  if (!state.scene) {
    state.scene = new CaseScene($("scene"), null, {
      onPickMount: (id, panel) => {
        state.selectedMount = id;
        setFace(panel);
      },
      onPickGpu: () => setFace("gpus"),
      onMoveFan: moveFan,
      onMoveGpu: (id, slot) => {
        const gpu = state.build.gpus.find((g) => g.id === id);
        if (gpu) gpu.slot = slot;
        changed(true);
      },
      onHover: (text, ev) => {
        const tip = $("tip");
        if (!text) {
          if (tip.dataset.src === "scene") tip.hidden = true;
          return;
        }
        tip.dataset.src = "scene";
        tip.textContent = text;
        tip.hidden = false;
        tip.style.left = `${Math.min(ev.clientX + 16, window.innerWidth - tip.offsetWidth - 8)}px`;
        tip.style.top = `${Math.min(ev.clientY + 16, window.innerHeight - tip.offsetHeight - 8)}px`;
      },
    });
  }
  state.build.seals = { ...DEFAULT_SEALS, ...(state.build.seals || {}) };
  state.build.filters = state.build.filters || {};
  state.build.patterns = state.build.patterns || {};
  $("build-name").textContent = state.build.name || state.build.id;
  $("mock-banner").classList.toggle("hidden", !state.build.illustrative_mock);
  renderPanel();
  renderResults();
}

/* ------------------------------------------------------------------ layout */

function setFace(face) {
  state.face = face;
  renderPanel();
  renderInset();
  state.scene?.update(sceneCtx());
}

function setView(view) {
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  state.scene?.setView(view);
}

function syncMobileChrome() {
  const on = window.matchMedia("(max-width: 800px)").matches;
  if (on && !state.mtabChosen) state.mtab = state.net === "full" ? "network" : state.net === "split" ? "split" : state.mtab || "pc";
  document.body.classList.toggle("is-mobile", on);
  for (const tab of ["pc", "customize", "network", "split"]) {
    document.body.classList.toggle(`mtab-${tab}`, on && state.mtab === tab);
  }
  document.querySelectorAll("[data-mtab]").forEach((b) => b.classList.toggle("on", b.dataset.mtab === state.mtab));
}

function setMobileTab(tab) {
  state.mtab = tab;
  state.mtabChosen = true;
  if (tab === "network") setNet("full");
  else if (tab === "split") setNet("split");
  else setNet("off");
  syncMobileChrome();
}

function renderMobileTemps() {
  const root = $("mobile-temps");
  if (!root) return;
  const sol = state.solution;
  root.replaceChildren();
  if (!sol || sol.error) {
    root.append(el("span", { class: "hot" }, sol?.error ? "—" : "…"));
    return;
  }
  root.append(el("span", { class: "hot", style: `color:${tempColor(sol.hottest_die_c)}` }, `Hottest ${fmt(sol.hottest_die_c)}`));
  const byId = Object.fromEntries(sol.cards.map((c) => [c.id, c]));
  orderedGpus().forEach((g, i) => {
    const c = byId[g.id];
    if (!c) return;
    root.append(el("span", { class: "mt", style: `color:${tempColor(c.t_die_c)}` }, `GPU ${i + 1} ${fmt(c.t_die_c)}`));
  });
}

function setNet(mode, quiet) {
  if (!["off", "split", "full"].includes(mode)) return;
  state.net = mode;
  document.querySelectorAll("[data-net]").forEach((b) => b.classList.toggle("on", b.dataset.net === mode));
  const stage = $("stage");
  stage.classList.remove("net-off", "net-split", "net-full");
  stage.classList.add(`net-${mode}`);
  document.body.classList.remove("net-off", "net-split", "net-full");
  document.body.classList.add(`net-${mode}`);
  if (!quiet) renderResults();
}

/* ------------------------------------------------------------------ panels */

function renderPanel() {
  document.querySelectorAll("#facebar button").forEach((b) => b.classList.toggle("on", b.dataset.face === state.face));
  renderFacebar();
  const root = $("panel");
  root.innerHTML = "";
  if (state.face === "case") root.append(...casePanel());
  else if (FACES.includes(state.face)) root.append(...facePanel(state.face));
  else if (state.face === "internals") root.append(...internalsPanel());
  else root.append(...gpusPanel());
}

function casePanel() {
  const b = state.build;
  const kase = caseOf();
  const out = [el("h2", {}, "Case"), el("p", { class: "sub" }, "What it all goes inside. Start here, then work down the list on the left.")];
  out.push(
    selectField(
      "Case",
      b,
      "case",
      state.presets.cases.map((c) => [c.id, c.name]),
      "Case preset: dimensions, slots and fan mounts are cited on the preset file.",
      () => {
        const next = caseOf();
        b.patterns = {};
        b.mounts = next.mounts.map((mt) => b.mounts.find((x) => x.id === mt.id) || { id: mt.id, panel: mt.panel, size_mm: mt.size_mm, fan: null, state: "blanked", direction: "intake", duty: 1 });
        respace(currentGaps());
      },
    ),
  );
  const facts = [
    `${kase.width_mm} × ${kase.height_mm} × ${kase.depth_mm} mm (W × H × D)`,
    `${kase.horizontal_slots} horizontal slots${kase.vertical_positions.length ? ` + ${kase.vertical_positions.length} vertical` : ""}`,
    ...Object.entries(kase.fan_support || {}).filter(([k]) => k !== "total").map(([k, v]) => `${cap(k)}: ${v}`),
  ];
  out.push(el("ul", { class: "fine" }, facts.map((f) => el("li", {}, f))));
  const tpl = el("select", { tip: "Replace the whole build with a saved one." }, el("option", { value: "" }, "Load a saved build…"), state.presets.builds.map((x) => el("option", { value: x.id }, x.name)));
  tpl.onchange = () => tpl.value && loadBuild(tpl.value);
  out.push(el("label", {}, "Saved builds", tpl));
  out.push(el("div", { class: "row" }, numberField("Room °C", b, "ambient_c", TIPS.ambient, { step: 0.5 }), numberField("Altitude m", b, "altitude_m", TIPS.altitude, { step: 50 })));
  return out;
}

const defaultDir = (face) => (face === "rear" || face === "top" ? "exhaust" : "intake");

function activePattern(face) {
  const options = facePatterns(caseOf(), face);
  if (!options.length) return null;
  return options.includes(state.build.patterns?.[face]) ? state.build.patterns[face] : options[0];
}

function mountsOn(face) {
  return activeLayouts(caseOf(), state.build.patterns)
    .filter((l) => l.panel === face)
    .map((layout) => {
      let mount = state.build.mounts.find((m) => m.id === layout.id);
      if (!mount) {
        mount = { id: layout.id, panel: face, size_mm: layout.size_mm, fan: null, state: "blanked", direction: defaultDir(face), duty: 1 };
        state.build.mounts.push(mount);
      }
      return mount;
    });
}

const topFans = (size) => state.presets.fans.filter((f) => f.size_mm === size).sort((a, b) => b.static_pressure_mmh2o - a.static_pressure_mmh2o).slice(0, 10);
const fanLabel = (f) => `${f.name} · ${f.airflow_cfm.toFixed(0)} CFM · ${f.static_pressure_mmh2o} mmH₂O`;

/* One face, one decision: which fan goes on it. The sizes the face supports
 * are option groups; picking the other size switches the face's pattern. */
function facePanel(face) {
  const kase = caseOf();
  const out = [];
  out.push(el("h2", {}, cap(face)));
  const support = kase.fan_support?.[face];
  out.push(el("p", { class: "sub" }, support ? `${kase.name} · supports ${support}` : `${kase.name} · no fan mounts on this face`));

  const mounts = mountsOn(face);
  const fanMounts = mounts.filter((m) => m.state !== "radiator");
  if (fanMounts.length) {
    const patterns = facePatterns(kase, face);
    const current = activePattern(face);
    const sizes = patterns.length
      ? patterns.map((p) => {
          const ls = kase.mounts.filter((l) => l.panel === face && l.pattern === p);
          return [p, ls[0].size_mm, ls.length];
        })
      : [[null, fanMounts[0].size_mm, fanMounts.length]];
    const pick = el("select", { tip: TIPS.fanSelect });
    pick.append(el("option", { value: "none" }, "No fans — cover plates"));
    sizes.forEach(([pattern, size, count]) => {
      const group = el("optgroup", { label: `${size} mm fans (×${count})` });
      topFans(size).forEach((f) => group.append(el("option", { value: `${pattern ?? ""}|${f.id}` }, fanLabel(f))));
      pick.append(group);
    });
    const withFans = fanMounts.filter((m) => m.state === "fan");
    const uniform = withFans.length === fanMounts.length && new Set(withFans.map((m) => `${m.fan}|${m.direction}|${m.duty ?? 1}`)).size === 1;
    if (!withFans.length) pick.value = "none";
    else if (uniform) pick.value = `${current ?? ""}|${withFans[0].fan}`;
    else {
      pick.prepend(el("option", { value: "mixed" }, "Mixed — see “one by one” below"));
      pick.value = "mixed";
    }
    const dir = withFans[0]?.direction || defaultDir(face);
    const dirBtn = el("button", { type: "button", class: `dir ${dir}`, tip: TIPS.direction, disabled: !withFans.length }, dir);
    dirBtn.onclick = () => {
      const next = dirBtn.textContent === "intake" ? "exhaust" : "intake";
      mountsOn(face).forEach((m) => m.state === "fan" && (m.direction = next));
      changed(true);
    };
    pick.onchange = () => {
      if (pick.value === "mixed") return;
      if (pick.value === "none") {
        mountsOn(face).forEach((m) => m.state !== "radiator" && setMountFan(m, "__blanked"));
      } else {
        const [pattern, fanId] = pick.value.split("|");
        if (pattern && pattern !== current) {
          state.build.patterns[face] = pattern;
          if (state.build.radiator?.model && state.build.radiator.panel === face) placeRadiator(face, state.build.radiator.model);
        }
        mountsOn(face).forEach((m) => m.state !== "radiator" && setMountFan(m, fanId, dirBtn.textContent));
      }
      changed(true);
    };
    out.push(el("label", { tip: TIPS.fanSelect }, `${cap(face)} fans`, el("div", { class: "big-row" }, pick, dirBtn)));
    const summary = faceFanLabel(face, mounts, state.presets);
    if (summary) out.push(el("p", { class: "fine" }, summary));

    const individual = el("details", { open: !uniform && withFans.length > 0 }, el("summary", {}, "Not all the same? Set fans one by one"));
    fanMounts.forEach((m, i) => {
      const sel = el("select", { tip: TIPS.fanSelect });
      sel.append(el("option", { value: "__blanked" }, "cover plate (plugged)"), el("option", { value: "__empty" }, "open hole, no fan"));
      topFans(m.size_mm).forEach((f) => sel.append(el("option", { value: f.id }, fanLabel(f))));
      sel.value = m.state === "fan" && m.fan ? m.fan : m.state === "empty" ? "__empty" : "__blanked";
      sel.onchange = () => {
        setMountFan(m, sel.value, m.state === "fan" ? m.direction : defaultDir(face));
        changed(true);
      };
      const d = el("button", { type: "button", class: `dir ${m.state === "fan" ? m.direction : ""}`, tip: TIPS.direction, disabled: m.state !== "fan" }, m.state === "fan" ? m.direction : "—");
      d.onclick = () => {
        m.direction = m.direction === "intake" ? "exhaust" : "intake";
        changed(true);
      };
      const duty = el("input", { type: "number", min: 0, max: 100, step: 5, value: Math.round((m.duty ?? 1) * 100), tip: TIPS.duty, disabled: m.state !== "fan" });
      duty.onchange = () => {
        m.duty = Math.max(0, Math.min(1, Number(duty.value) / 100));
        changed();
      };
      individual.append(el("div", { class: `mount-row${state.selectedMount === m.id ? " sel" : ""}` }, el("span", { class: "mid" }, `#${i + 1} · ${m.size_mm}`), sel, d, duty));
    });
    individual.append(el("p", { class: "fine" }, "Fan · direction · speed %. Click a fan in the 3D view to find it here."));
    out.push(individual);
  }

  if (face === "side") {
    const side = el("select", { tip: TIPS.side }, [["tempered_glass", "tempered glass (sealed)"], ["mesh", "mesh"], ["removed", "removed (open)"]].map(([v, t]) => el("option", { value: v }, t)));
    side.value = state.build.side_panel || "tempered_glass";
    side.onchange = () => {
      state.build.side_panel = side.value;
      state.build.seals.side = side.value === "removed" ? 1 : side.value === "mesh" ? Math.min(state.build.seals.side ?? 3, 3) : 5;
      changed(true);
    };
    out.push(el("label", { tip: TIPS.side }, "Side panel", side));
  }
  if (face === "rear") out.push(selectField("Rear exhaust shroud", state.build.shroud, "mode", [["off", "off"], ["on", "on, with its fans"], ["passive", "passive duct, no fans"]], TIPS.shroud));
  if (RADIATOR_FACES.includes(face)) out.push(...radiatorControls(face));

  const sealKey = SEAL_FOR_FACE[face];
  const extras = el("details", {}, el("summary", {}, face === "rear" ? "Slot covers, seal and shroud fans" : "Seal and dust filter"));
  if (face === "rear") extras.append(checkbox("Slot covers removed (open slot mouths)", "brackets_removed", TIPS.brackets));
  if (sealKey) extras.append(sealSlider(sealKey, face === "rear" ? "Rear slot openings" : `${cap(face)} panel around the fans`));
  if (FILTER_FACES.includes(face)) {
    const filt = el("select", { tip: TIPS.filter }, ["none", "fine", "dense"].map((v) => el("option", { value: v }, v)));
    filt.value = state.build.filters[face] || "none";
    filt.onchange = () => {
      state.build.filters[face] = filt.value;
      changed();
    };
    extras.append(el("label", { tip: TIPS.filter }, "Dust filter in front of the fans", filt));
  }
  if (face === "rear") {
    const s = state.build.shroud;
    const fans = state.presets.fans.filter((f) => f.size_mm >= 120);
    extras.append(
      el("div", { class: "row" },
        selectField("Shroud fan", s, "fan", fans.map((f) => [f.id, f.name]), TIPS.shroudFan),
        numberField("Count", s, "count", TIPS.shroudFan, { min: 0, max: 4 }),
        numberField("Speed %", s, "duty", TIPS.duty, { scale: 100, min: 0, max: 100, step: 5 }),
      ),
    );
  }
  out.push(extras);
  return out;
}

function setMountFan(m, value, direction, face) {
  if (value === "__blanked") {
    m.state = "blanked";
    m.fan = null;
  } else if (value === "__empty") {
    m.state = "empty";
    m.fan = null;
  } else {
    m.state = "fan";
    m.fan = value;
    m.direction = direction || defaultDir(face || m.panel);
    m.duty = m.duty ?? 1;
  }
}

function sealSlider(key, label) {
  const level = state.build.seals[key] ?? DEFAULT_SEALS[key] ?? 3;
  const name = el("span", { class: "seal-name" }, SEAL_TEXT[level]);
  const input = el("input", { type: "range", min: 1, max: 5, step: 1, value: level, tip: TIPS.seal });
  input.oninput = () => {
    state.build.seals[key] = Number(input.value);
    name.textContent = SEAL_TEXT[input.value];
    changed();
  };
  return el("label", { tip: TIPS.seal }, `${label} · seal level (1 open … 5 sealed)`, input, name);
}

function checkbox(label, key, tip, obj = state.build, after) {
  const input = el("input", { type: "checkbox", checked: !!obj[key] });
  input.onchange = () => {
    obj[key] = input.checked;
    after?.();
    changed(true);
  };
  return el("label", { class: "check", tip }, input, label);
}

function selectField(label, obj, key, options, tip, after) {
  const sel = el("select", { tip }, options.map(([v, t]) => el("option", { value: v }, t)));
  sel.value = obj[key] ?? options[0][0];
  sel.onchange = () => {
    obj[key] = sel.value;
    after?.();
    changed(true);
  };
  return el("label", { tip }, label, sel);
}

function numberField(label, obj, key, tip, opts = {}) {
  const input = el("input", { type: "number", value: obj[key] ?? 0, step: opts.step ?? 1, min: opts.min, max: opts.max, tip });
  input.onchange = () => {
    obj[key] = opts.scale ? Number(input.value) / opts.scale : Number(input.value);
    changed();
  };
  if (opts.scale) input.value = Math.round((obj[key] ?? 0) * opts.scale);
  return el("label", { tip }, label, input);
}

function radiatorControls(face) {
  const rad = state.build.radiator;
  const here = !!rad.model && rad.panel === face;
  const toggle = el("input", { type: "checkbox", checked: here });
  toggle.onchange = () => {
    if (toggle.checked) placeRadiator(face, rad.model || state.presets.radiators[0].id);
    else removeRadiator();
    changed(true);
  };
  const out = [el("label", { class: "check", tip: TIPS.radiator }, toggle, `Radiator on the ${face}${rad.model && !here ? ` (now on the ${rad.panel})` : ""}`)];
  if (!here) return out;
  const box = el("details", {}, el("summary", {}, "Radiator model, direction and fans"));
  box.append(selectField("Model", rad, "model", state.presets.radiators.map((r) => [r.id, `${r.name} · ${r.thickness_mm} mm`]), TIPS.radiator, () => placeRadiator(face, rad.model)));
  box.append(selectField("Direction", rad, "direction", [["exhaust", "exhaust"], ["intake", "intake"]], TIPS.radDir));
  if (face !== "front") box.append(selectField("Position along the panel", rad, "offset", [["center", "centred"], ["rear", "slid to the rear"], ["front", "slid to the front"]], "Where the radiator sits along the panel. Drawing only: the airflow model treats the radiator as one branch wherever it sits."));
  const radFans = state.presets.fans.filter((f) => f.size_mm === 120 || f.size_mm === 140);
  box.append(el("div", { class: "row" }, selectField("Radiator fans", rad, "fan", radFans.map((f) => [f.id, f.name]), TIPS.radFans), numberField("Count", rad, "fan_count", TIPS.radFans, { min: 1, max: 4 })));
  if (state.build.cpu?.cooling !== "water") box.append(el("p", { class: "fine warn" }, "The CPU is air-cooled, so this radiator carries no heat. Set the CPU to water under Internals."));
  out.push(box);
  return out;
}

function placeRadiator(face, model) {
  const rad = state.build.radiator;
  state.build.mounts.forEach((m) => {
    if (m.state === "radiator") m.state = "blanked";
  });
  rad.model = model;
  rad.panel = face;
  const r = state.presets.radiators.find((x) => x.id === model);
  const count = r ? r.fan_count : 3;
  rad.fan_count = rad.fan_count || count;
  if (!rad.fan) rad.fan = r?.default_fan || "generic-120";
  mountsOn(face).slice(0, count).forEach((m) => {
    m.state = "radiator";
    m.fan = null;
  });
}

function removeRadiator() {
  state.build.radiator.model = null;
  state.build.mounts.forEach((m) => {
    if (m.state === "radiator") m.state = "blanked";
  });
  if (state.build.cpu?.cooling === "water") state.build.cpu.cooling = "air";
}

function internalsPanel() {
  const b = state.build;
  const cpu = (b.cpu ||= { power_w: 150, cooling: "air" });
  const out = [el("h2", {}, "Internals"), el("p", { class: "sub" }, "The CPU, and what sits in the airflow.")];
  const coolBtns = ["air", "water"].map((mode) => {
    const btn = el("button", { type: "button", class: cpu.cooling === mode ? "on" : "", tip: TIPS.cpuCooling }, mode === "air" ? "Air cooler" : "Water (AIO)");
    btn.onclick = () => {
      cpu.cooling = mode;
      // The radiator only exists for a water-cooled CPU here (GPU AIOs are out
      // of scope), so an air cooler takes it off and water puts one on.
      if (mode === "water" && !b.radiator.model) placeRadiator("top", state.presets.radiators[0].id);
      if (mode === "air" && b.radiator.model) removeRadiator();
      changed(true);
    };
    return btn;
  });
  out.push(el("label", { tip: TIPS.cpuCooling }, "CPU cooling", el("div", { class: "seg" }, ...coolBtns)));
  out.push(numberField("CPU heat, W", cpu, "power_w", TIPS.cpuPower, { min: 0, step: 5 }));
  if (cpu.cooling === "air") {
    cpu.cooler_fans ||= "both";
    cpu.cooler_airflow ||= "up";
    out.push(
      selectField(
        "Cooler fans",
        cpu,
        "cooler_fans",
        [["both", "both (push-pull, stock)"], ["top", "top fan only"], ["bottom", "bottom fan only"]],
        TIPS.cpuFans,
      ),
    );
  }
  if (cpu.cooling === "water") out.push(el("p", { class: "fine" }, b.radiator.model ? `Heat leaves through the radiator on the ${b.radiator.panel} (${b.radiator.direction}).` : "Needs a radiator: add one on the front, top or bottom face."));
  out.push(
    el("div", { class: "row" },
      selectField("Obstruction", b, "obstruction", [["low", "low"], ["medium", "medium"], ["high", "high"]], TIPS.obstruction),
      selectField("Cables", b, "cables", [["clean", "clean"], ["cluttered", "cluttered"]], TIPS.cables),
    ),
  );
  const more = el("details", {}, el("summary", {}, "PSU, drive cage, cooler fan, environment"));
  if (cpu.cooling === "air") {
    cpu.cooler_fan ||= "generic-140";
    const fans = state.presets.fans.filter((f) => f.size_mm === 120 || f.size_mm === 140);
    more.append(
      el("div", { class: "row" },
        selectField("Tower cooler fan", cpu, "cooler_fan", fans.map((f) => [f.id, f.name]), TIPS.cpuFan),
        numberField("Speed %", cpu, "cooler_duty", TIPS.duty, { scale: 100, min: 0, max: 100, step: 5 }),
      ),
      selectField("Cooler airflow", cpu, "cooler_airflow", [["up", "bottom → top (sTR5 / Threadripper)"], ["rear", "front → rear (classic tower)"]], TIPS.cpuAirflow),
    );
  }
  more.append(
    el("div", { class: "row" },
      selectField("PSU", b, "psu_location", [["bottom_shroud", "bottom, shrouded"], ["open", "bottom, open"]], TIPS.psu),
      selectField("PSU fan", b, "psu_fan", [["down", "down"], ["up", "up"]], TIPS.psuFan),
      selectField("Drive cage", b, "drive_cage", [["removed", "removed"], ["present", "in the intake path"]], TIPS.cage),
    ),
    sealSlider("seams", "Panel seams"),
    numberField("Wall re-ingestion °C", b, "room_reingestion_c", TIPS.reingest, { step: 0.5 }),
    checkbox("Buoyancy (stack effect)", "buoyancy", TIPS.buoyancy),
  );
  out.push(more);
  return out;
}

function gpusPanel() {
  const b = state.build;
  const kase = caseOf();
  const out = [el("h2", {}, "GPUs"), el("p", { class: "sub" }, `${kase.horizontal_slots} horizontal slots${kase.vertical_positions.length ? ` + vertical ${kase.vertical_positions.map((v) => v.id).join(", ")}` : ""}. GPU 1 is nearest the CPU; vertical cards come last.`)];

  const group = (label, list) => el("optgroup", { label }, list.map((c) => el("option", { value: c.id }, `${c.name}${c.template ? " (template)" : ""} · ${c.tbp_w} W`)));
  const blowers = state.presets.cards.filter((c) => c.cooler !== "flow_through");
  const through = state.presets.cards.filter((c) => c.cooler === "flow_through");
  const cardSel = el("select", { tip: TIPS.card });
  cardSel.append(el("option", { value: "" }, "Mixed — set each card below"));
  cardSel.append(group("Blower — exhaust out the rear bracket", blowers), group("Flow-through — exhaust up into the card above", through));
  const cardsUsed = new Set(b.gpus.map((g) => g.card));
  cardSel.value = cardsUsed.size === 1 ? [...cardsUsed][0] : "";
  cardSel.onchange = () => {
    if (!cardSel.value) return;
    const gaps = currentGaps();
    b.gpus.forEach((g) => {
      g.card = cardSel.value;
      g.power_limit_w = cardOf(g.card)?.tbp_w ?? g.power_limit_w;
    });
    respace(gaps);
    changed(true);
  };
  out.push(el("label", { tip: TIPS.card }, "All cards", cardSel));
  const count = el("select", {}, [1, 2, 3, 4, 5, 6].map((n) => el("option", { value: n }, `${n} card${n > 1 ? "s" : ""}`)));
  count.value = b.gpus.length;
  count.onchange = () => {
    const n = Number(count.value);
    const gaps = currentGaps();
    while (b.gpus.length > n) b.gpus.splice(b.gpus.indexOf(orderedGpus().at(-1)), 1);
    while (b.gpus.length < n) {
      let id = b.gpus.length + 1;
      while (b.gpus.some((g) => g.id === `gpu${id}`)) id += 1;
      const proto = b.gpus[0];
      const gpu = gpuTemplate(`gpu${id}`, "99", proto?.card || "rtx-pro-6000-blackwell-maxq");
      if (proto) Object.assign(gpu, { fan_curve: proto.fan_curve, custom_curve: proto.custom_curve, power_limit_w: proto.power_limit_w });
      b.gpus.push(gpu);
    }
    respace(gaps);
    changed(true);
  };
  const spacing = el("select", { tip: TIPS.spacing }, [0, 1, 2, 3].map((g) => el("option", { value: g }, g === 0 ? "stacked (no gap)" : `${g} empty slot${g > 1 ? "s" : ""} between`)));
  spacing.value = currentGaps();
  spacing.onchange = () => {
    respace(Number(spacing.value));
    changed(true);
  };
  out.push(el("div", { class: "row" }, el("label", {}, "How many", count), el("label", { tip: TIPS.spacing }, "Spacing", spacing)));
  const vertical = orderedGpus().filter((g) => isVertical(g.slot)).length;
  if (vertical) out.push(el("p", { class: "fine" }, `${vertical} card${vertical > 1 ? "s" : ""} on a vertical mount: ${vertical > 1 ? "they don't" : "it doesn't"} fit in the horizontal slots at this spacing.`));
  if (state.notice) out.push(el("p", { class: "fine warn" }, state.notice));
  const curve = el("select", { tip: TIPS.curve }, [el("option", { value: "" }, "Mixed / custom — set each card below"), el("option", { value: "stock" }, "Stock"), el("option", { value: "custom_accelerated" }, "Custom Accelerated (0 % @ 25 °C → 100 % @ 70 °C)")]);
  const curves = new Set(b.gpus.map((g) => g.fan_curve));
  curve.value = curves.size === 1 && [...curves][0] !== "custom" ? [...curves][0] : "";
  curve.onchange = () => {
    if (!curve.value) return;
    b.gpus.forEach((g) => (g.fan_curve = curve.value));
    changed(true);
  };
  out.push(el("label", { tip: TIPS.curve }, "GPU fan curve", curve));

  const results = Object.fromEntries((state.solution?.cards || []).map((c) => [c.id, c]));
  const slots = [];
  for (let s = 1; s <= kase.horizontal_slots; s += 1) slots.push([String(s), `slot ${s}`]);
  kase.vertical_positions.forEach((v) => slots.push([v.id, `vertical ${v.id}`]));
  const each = el("details", {}, el("summary", {}, "Set each card: model, slot, power, curve, clocks"));
  orderedGpus().forEach((g, index) => {
    const res = results[g.id];
    const one = el("select", { tip: TIPS.card }, group("Blower", blowers), group("Flow-through", through));
    one.value = g.card;
    one.onchange = () => {
      g.card = one.value;
      g.power_limit_w = cardOf(g.card)?.tbp_w ?? g.power_limit_w;
      changed(true);
    };
    const slotSel = el("select", { tip: TIPS.slot }, slots.map(([v, t]) => el("option", { value: v }, t)));
    slotSel.value = String(g.slot);
    slotSel.onchange = () => {
      g.slot = slotSel.value;
      changed(true);
    };
    const c1 = el("select", { tip: TIPS.curve }, [["stock", "Stock"], ["custom_accelerated", "Custom Accelerated"], ["custom", "Custom points / fixed %"]].map(([v, t]) => el("option", { value: v }, t)));
    c1.value = g.fan_curve === "maxq_aggressive" ? "custom_accelerated" : g.fan_curve;
    c1.onchange = () => {
      g.fan_curve = c1.value;
      if (c1.value === "custom" && !g.custom_curve) g.custom_curve = [[30, 0.3], [60, 0.55], [75, 0.8], [90, 1]];
      changed(true);
    };
    const box = el(
      "div",
      { class: "box gpu-card" },
      el("div", { class: "head" }, el("b", {}, `GPU ${index + 1}${isVertical(g.slot) ? " · vertical" : ""}`), el("span", { class: "t", style: `color:${tempColor(res?.t_die_c)}` }, res ? fmt(res.t_die_c) : "…")),
      one,
      el("div", { class: "row" }, el("label", { tip: TIPS.slot }, "Slot", slotSel), numberField("Power W", g, "power_limit_w", TIPS.power, { min: 50, step: 5 })),
      el("label", { tip: TIPS.curve }, "Fan curve", c1),
    );
    if (g.fan_curve === "custom") {
      const pts = el("input", { type: "text", value: (g.custom_curve || []).map(([t, d]) => `${t}:${d}`).join(", "), tip: TIPS.customCurve });
      pts.onchange = () => {
        const parsed = pts.value.split(",").map((p) => p.split(":").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
        if (parsed.length >= 1) {
          g.custom_curve = parsed.length === 1 ? [[0, parsed[0][1]], [100, parsed[0][1]]] : parsed;
          changed();
        }
      };
      box.append(el("label", { tip: TIPS.customCurve }, "Points °C:duty (one pair = fixed duty)", pts));
    }
    box.append(
      el("details", {}, el("summary", {}, "Clocks and voltage (approximations)"),
        el("div", { class: "row" },
          numberField("Mem MHz", g, "memory_clock_offset_mhz", TIPS.memOffset, { step: 50 }),
          numberField("Core MHz", g, "core_clock_offset_mhz", TIPS.coreOffset, { step: 15 }),
          numberField("Undervolt mV", g, "undervolt_mv", TIPS.undervolt, { step: 5 }),
        )),
    );
    each.append(box);
  });
  out.push(each);
  return out;
}

/* Empty slots between the first two horizontal cards, as the spacing control reads it. */
function currentGaps() {
  if (state.gaps != null) return state.gaps;
  const horiz = orderedGpus().filter((g) => !isVertical(g.slot));
  if (horiz.length < 2) return 1;
  const w = cardOf(horiz[0].card)?.slots || 2;
  return Math.max(0, Math.min(3, Number(horiz[1].slot) - Number(horiz[0].slot) - w));
}

/* Put every card in a horizontal slot, top down with `gaps` empty slots
 * between, while they fit. Only cards that do not fit go to a vertical mount
 * (a card already on a vertical mount keeps it first). Returns cards that fit
 * nowhere, which are removed. */
function respace(gaps) {
  state.gaps = gaps;
  const kase = caseOf();
  const cards = orderedGpus();
  const verticalPool = [
    ...cards.filter((g) => isVertical(g.slot)).map((g) => g.slot),
    ...kase.vertical_positions.map((v) => v.id),
  ].filter((v, i, all) => all.indexOf(v) === i);
  let cursor = 1;
  const dropped = [];
  cards.forEach((g) => {
    const width = cardOf(g.card)?.slots || 2;
    if (cursor + width - 1 <= kase.horizontal_slots) {
      g.slot = String(cursor);
      cursor += width + gaps;
    } else if (verticalPool.length) {
      g.slot = verticalPool.shift();
    } else {
      dropped.push(g);
    }
  });
  if (dropped.length) {
    state.build.gpus = state.build.gpus.filter((g) => !dropped.includes(g));
    state.notice = `${dropped.length} card${dropped.length > 1 ? "s" : ""} did not fit with that spacing and ${dropped.length > 1 ? "were" : "was"} removed.`;
  } else {
    state.notice = null;
  }
  return dropped;
}

function addGpu(solve = true) {
  const kase = caseOf();
  const used = new Set();
  state.build.gpus.forEach((g) => {
    if (isVertical(g.slot)) return;
    const w = cardOf(g.card)?.slots || 2;
    for (let s = Number(g.slot); s < Number(g.slot) + w; s += 1) used.add(s);
  });
  const card = state.build.gpus[0]?.card || "rtx-pro-6000-blackwell-maxq";
  const w = cardOf(card)?.slots || 2;
  let slot = null;
  for (let s = 1; s + w - 1 <= kase.horizontal_slots; s += 1) {
    let free = true;
    for (let k = s; k < s + w; k += 1) if (used.has(k)) free = false;
    if (free) {
      slot = String(s);
      break;
    }
  }
  if (!slot) slot = kase.vertical_positions.find((v) => !state.build.gpus.some((g) => g.slot === v.id))?.id;
  if (!slot) return false;
  let n = state.build.gpus.length + 1;
  while (state.build.gpus.some((g) => g.id === `gpu${n}`)) n += 1;
  const proto = state.build.gpus[0];
  const gpu = gpuTemplate(`gpu${n}`, slot, card);
  if (proto) Object.assign(gpu, { fan_curve: proto.fan_curve, custom_curve: proto.custom_curve, power_limit_w: proto.power_limit_w });
  state.build.gpus.push(gpu);
  if (solve) changed(true);
  return true;
}

function moveFan(fromId, toId) {
  const from = state.build.mounts.find((m) => m.id === fromId);
  const layout = caseOf().mounts.find((l) => l.id === toId);
  const to = state.build.mounts.find((m) => m.id === toId) || (layout && mountsOn(layout.panel).find((m) => m.id === toId));
  if (!from || !to || from.state !== "fan" || to.state === "radiator") return;
  const keep = { fan: to.fan, state: to.state, direction: to.direction, duty: to.duty };
  Object.assign(to, { fan: from.fan, state: "fan", direction: from.direction, duty: from.duty });
  Object.assign(from, keep);
  state.selectedMount = to.id;
  state.face = layout?.panel || state.face;
  changed(true);
}

function renderFacebar() {
  const b = state.build;
  const kase = caseOf();
  $("fb-case").textContent = kase.name.replace(/^(Fractal Design|Corsair iCUE LINK|Corsair|Phanteks) /, "");
  FACES.forEach((face) => {
    const mounts = activeLayouts(kase, b.patterns).filter((l) => l.panel === face).map((l) => b.mounts.find((m) => m.id === l.id) || { state: "blanked" });
    const fans = mounts.filter((m) => m.state === "fan");
    const intake = fans.filter((m) => m.direction === "intake").length;
    const exhaust = fans.length - intake;
    const parts = [];
    if (intake) parts.push(`${intake} in`);
    if (exhaust) parts.push(`${exhaust} out`);
    if (b.radiator?.model && b.radiator.panel === face) parts.push("radiator");
    if (face === "rear" && b.shroud?.mode !== "off") parts.push("shroud");
    if (face === "side") parts.push(b.side_panel === "tempered_glass" ? "glass" : b.side_panel);
    $(`fb-${face}`).textContent = parts.join(" · ") || (mounts.length ? "plugged" : "no mounts");
  });
  $("fb-internals").textContent = `CPU ${b.cpu?.cooling === "water" ? "AIO" : "air"} ${Math.round(b.cpu?.power_w ?? 0)} W`;
  $("fb-gpus").textContent = `${b.gpus.length} × ${(cardOf(b.gpus[0]?.card)?.name || "").replace(/^NVIDIA (GeForce )?/, "").replace(/ Blackwell/, "").replace(/ \(\d+ W\)$/, "")}`;
}

/* ------------------------------------------------------------------ solve + results */

let timer = null;
function changed(rerenderPanel = false) {
  if (rerenderPanel) renderPanel();
  else renderFacebar();
  state.scene?.update(sceneCtx());
  renderInset();
  clearTimeout(timer);
  timer = setTimeout(solveNow, 160);
}

async function solveNow() {
  $("ambient-readout").textContent = `room ${fmt(Number(state.build.ambient_c))}`;
  try {
    const res = await fetch("/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state.build) });
    const body = await res.json();
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
    state.solution = body;
  } catch (err) {
    state.solution = { error: String(err.message || err), cards: [], branches: [], notes: [] };
  }
  renderResults();
  if (state.face === "gpus") renderPanel();
}

function sceneCtx() {
  const order = Object.fromEntries(orderedGpus().map((g, i) => [g.id, i + 1]));
  return {
    build: state.build,
    kase: caseOf(),
    solution: state.solution && !state.solution.error ? state.solution : null,
    presets: state.presets,
    selectedMount: state.selectedMount,
    order,
    fmt,
    tempColor,
  };
}

function renderResults() {
  if (!state.build) return;
  renderReadout();
  state.scene?.update(sceneCtx());
  renderInset();
  if (state.net !== "off") renderNetwork($("netview"), { solution: state.solution, build: state.build, presets: state.presets, fmt, mode: state.net });
  if (state.compare) renderCompare();
  renderFacebar();
}

/* Stats, off to the side: the hottest card, the case, then GPU 1…n in order. */
function renderReadout() {
  renderMobileTemps();
  const sol = state.solution;
  const root = $("readout");
  root.innerHTML = "";
  if (!sol || sol.error) {
    root.append(el("p", { class: "warn" }, sol ? sol.error : "Solving…"));
    return;
  }
  const sign = sol.case_pressure_pa >= 0 ? "+" : "−";
  $("pressure-readout").textContent = `case ${sign}${Math.abs(sol.case_pressure_pa).toFixed(1)} Pa`;
  const throttled = sol.cards.some((c) => c.throttle);
  $("hot-readout").textContent = `hottest ${fmt(sol.hottest_die_c)}`;
  $("hot-readout").style.color = tempColor(sol.hottest_die_c);
  const byId = Object.fromEntries(sol.cards.map((c) => [c.id, c]));
  const intake = (sol.branches || []).filter((b) => b.a === "amb" && b.flow_cfm > 0).reduce((s, b) => s + b.flow_cfm, 0);
  root.append(
    el("div", { class: "fine" }, "Hottest GPU"),
    el("div", { class: "stat-hot", style: `color:${tempColor(sol.hottest_die_c)}` }, fmt(sol.hottest_die_c)),
    throttled
      ? el(
          "div",
          { class: "throttle", tip: TIPS.unthrottled },
          sol.cards.some((c) => c.power_w < c.power_unthrottled_w - 1)
            ? `THROTTLING · would be ${fmt(sol.hottest_unthrottled_c)} at full power`
            : "At the throttle flag · clocks start to drop here, no power lost yet",
        )
      : "",
    el(
      "div",
      { class: "stats" },
      el("span", { tip: TIPS.casePa }, "Case pressure"), el("b", {}, `${sign}${Math.abs(sol.case_pressure_pa).toFixed(1)} Pa`),
      el("span", {}, "Fresh air in"), el("b", {}, `${intake.toFixed(0)} CFM`),
      el("span", {}, "Heat"), el("b", {}, `${sol.heat_w.toFixed(0)} W`),
      el("span", {}, "Room"), el("b", {}, fmt(Number(state.build.ambient_c))),
    ),
  );
  const order = orderedGpus();
  order.forEach((g, i) => {
    const c = byId[g.id];
    if (!c) return;
    const card = cardOf(c.card);
    const plume = (sol.plume || []).find((p) => p.upper === c.id && p.share_of_upper_intake > 0.005);
    const stack = (sol.branches || []).find((b) => b.kind === "stack" && b.b === `cin-${c.id}` && b.flow_cfm > 1);
    const fromId = plume?.lower || stack?.a?.replace("cex-", "");
    const from = fromId ? order.findIndex((x) => x.id === fromId) + 1 : 0;
    const where = isVertical(g.slot) ? `vertical mount ${g.slot}` : `slot ${g.slot}`;
    root.append(
      el(
        "div",
        { class: `gpu-line${isVertical(g.slot) ? " vertical" : ""}`, tip: `${card ? card.name : c.card}. Unthrottled ${fmt(c.t_die_unthrottled_c)}, memory ${fmt(c.t_mem_c)}, inlet air ${fmt(c.t_in_c)}, exhaust ${fmt(c.t_exh_c)}, ${c.power_w.toFixed(0)} W, gap ${c.gap_mm.toFixed(1)} mm.` },
        el("div", {}, el("b", {}, `GPU ${i + 1}`), el("span", { class: "where" }, `${where} · ${(card?.name || c.card).replace(/^NVIDIA (GeForce )?/, "").replace(/ \(\d+ W\)$/, "")} · ${c.power_w.toFixed(0)} W`)),
        el("div", { class: "t", style: `color:${tempColor(c.t_die_c)}` }, fmt(c.t_die_c)),
        el("div", { class: "sub" }, `${c.flow_cfm.toFixed(0)} CFM · fan ${Math.round(c.duty * 100)} % · inlet ${fmt(c.t_in_c)}${c.throttle ? (c.power_w < c.power_unthrottled_w - 1 ? " · throttling" : " · at throttle flag") : ""}${from ? ` · breathes GPU ${from}'s exhaust` : ""}`),
      ),
    );
  });
  root.append(el("details", {}, el("summary", { class: "fine" }, "Model notes"), ...sol.notes.map((n) => el("p", { class: "fine" }, n)), el("p", { class: "fine" }, `Energy balance ${(sol.energy_error * 100).toFixed(3)} % · mass residual ${sol.residual_kg_s.toExponential(1)} kg/s`)));
}

/* Head-on drawing of the selected face, scaled so every fan is visible. The
 * orientation matches the 3D view: front on the right when seen from the glass. */
function renderInset() {
  const root = $("face-inset");
  if (!state.build || !FACES.includes(state.face)) {
    root.classList.add("hidden");
    return;
  }
  const kase = caseOf();
  const face = state.face;
  const W = kase.width_mm;
  const H = kase.height_mm;
  const D = kase.depth_mm;
  const dims = { front: [W, H], rear: [W, H], top: [D, W], bottom: [D, W], side: [D, H] }[face];
  const map = (l) => {
    switch (face) {
      case "front": return [W - l.z_mm, H - l.y_mm];
      case "rear": return [l.z_mm, H - l.y_mm];
      case "top": return [D - l.x_mm, l.z_mm];
      case "bottom": return [D - l.x_mm, W - l.z_mm];
      default: return [D - l.x_mm, H - l.y_mm];
    }
  };
  const layouts = activeLayouts(kase, state.build.patterns).filter((l) => l.panel === face);
  if (!layouts.length) {
    root.classList.add("hidden");
    return;
  }
  const s = Math.min(230 / dims[0], 210 / dims[1]);
  const w = dims[0] * s;
  const h = dims[1] * s;
  const rad = state.build.radiator;
  const parts = [`<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" fill="#1c1813" stroke="#6d6254"/>`];
  layouts.forEach((l) => {
    const mnt = state.build.mounts.find((m) => m.id === l.id) || { state: "blanked" };
    const [x, y] = map(l);
    const r = (l.size_mm / 2) * s * 0.94;
    const color = mnt.state === "fan" ? (mnt.direction === "intake" ? "#3c8dff" : "#e24b3b") : mnt.state === "radiator" ? (rad.direction === "intake" ? "#3c8dff" : "#e24b3b") : "#8d877e";
    const fill = mnt.state === "fan" || mnt.state === "radiator" ? color : "none";
    const sel = state.selectedMount === l.id ? ' stroke="#f3efe6" stroke-width="3"' : ` stroke="${color}" stroke-width="1.5"`;
    const fan = fanOf(mnt.fan);
    const tip = mnt.state === "fan" ? `${fan ? fan.name : mnt.fan} · ${mnt.direction} · ${Math.round((mnt.duty ?? 1) * 100)} %` : mnt.state === "radiator" ? "radiator fan" : mnt.state === "empty" ? "open hole" : "cover plate (plugged)";
    parts.push(`<circle class="fan" data-id="${l.id}" data-tip="${tip}" cx="${x * s}" cy="${y * s}" r="${r}" fill="${fill}" fill-opacity="0.75"${sel}/>`);
  });
  const orient = { front: "seen from the front", rear: "seen from behind", top: "from above, front at right", bottom: "from below, front at right", side: "glass side, front at right" }[face];
  root.innerHTML = `<div>${cap(face)} · ${Math.round(dims[0])} × ${Math.round(dims[1])} mm · ${orient}</div><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  root.classList.remove("hidden");
  root.querySelectorAll("circle.fan").forEach((c) => {
    c.onclick = () => {
      state.selectedMount = c.dataset.id;
      renderPanel();
      renderInset();
      state.scene?.update(sceneCtx());
    };
  });
}

/* ------------------------------------------------------------------ compare, demo, optimize */

function toggleCompare() {
  if (state.compare) {
    state.compare = null;
    $("compare").classList.add("hidden");
    return;
  }
  state.compare = { build: JSON.parse(JSON.stringify(state.build)), solution: state.solution };
  $("compare").classList.remove("hidden");
  renderCompare();
}

function renderCompare() {
  const a = state.compare.solution;
  const b = state.solution;
  if (!a || !b || a.error || b.error) return;
  const n = Math.max(a.cards.length, b.cards.length);
  let rows = "";
  for (let i = 0; i < n; i += 1) {
    const ca = a.cards[i];
    const cb = b.cards[i];
    const d = ca && cb ? cb.t_die_c - ca.t_die_c : null;
    rows += `<tr><td>GPU ${i + 1}</td><td>${ca ? fmt(ca.t_die_c) : "—"}</td><td>${cb ? fmt(cb.t_die_c) : "—"}</td><td>${d == null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1)}</td></tr>`;
  }
  $("compare").innerHTML = `
    <div><h2>A · frozen: ${state.compare.build.name}</h2>
      <table><tr><th>Card</th><th>A</th><th>B (live)</th><th>Δ</th></tr>${rows}</table></div>
    <div><h2>B · live: ${state.build.name}</h2>
      <p class="fine">Case A ${a.case_pressure_pa.toFixed(1)} Pa · B ${b.case_pressure_pa.toFixed(1)} Pa. Edit the live build; A stays until you press Compare again.</p></div>`;
}

async function startDemo(id) {
  const choice = id || (state.build?.id?.startsWith("mike-bradley") ? "mike-bradley-demo" : "stefano-demo");
  state.demo = { id: choice, index: 0 };
  $("demo-bar").classList.remove("hidden");
  await loadDemoStep();
}

function stopDemo() {
  state.demo = null;
  clearInterval(state.demoTimer);
  $("demo-bar").classList.add("hidden");
}

async function stepDemo(delta) {
  if (!state.demo) return startDemo();
  const scenario = state.presets.scenarios.find((s) => s.id === state.demo.id);
  state.demo.index = Math.max(0, Math.min(scenario.steps.length - 1, state.demo.index + delta));
  await loadDemoStep();
}

async function loadDemoStep() {
  const res = await fetch("/api/scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario_id: state.demo.id, step: state.demo.index }),
  });
  const body = await res.json();
  state.build = body.optimal ? body.optimal.build : body.build;
  if (body.scenario.illustrative_mock) state.build.illustrative_mock = true;
  $("demo-title").textContent = body.step.title;
  $("demo-points").textContent = (body.step.talking_points || []).join(" ");
  const scenario = state.presets.scenarios.find((s) => s.id === state.demo.id);
  $("demo-count").textContent = `${state.demo.index + 1} / ${scenario.steps.length}`;
  enterApp();
  await solveNow();
  syncDemoTimer();
}

function syncDemoTimer() {
  clearInterval(state.demoTimer);
  if (!$("demo-auto").checked || !state.demo) return;
  state.demoTimer = setInterval(() => stepDemo(1), 9000);
}

function onKey(ev) {
  if (ev.target.matches("input, select, textarea")) return;
  if (!state.demo) return;
  if (ev.key === "ArrowRight") stepDemo(1);
  if (ev.key === "ArrowLeft") stepDemo(-1);
  if (ev.key === "Escape") stopDemo();
}

async function runOptimal() {
  const btn = $("opt-run");
  btn.textContent = "Searching…";
  try {
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards: state.build.gpus.length, case: state.build.case, mc: 30 }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "search failed");
    state.build = body.build;
    state.build.name = `Optimal · ${body.description.layout}, shroud ${body.description.shroud}, ${body.description.pressure}, ${body.description.leakage}, ${body.description.fan_curve}`;
    enterApp();
    await solveNow();
  } catch (err) {
    $("readout").prepend(el("p", { class: "warn" }, String(err.message || err)));
  } finally {
    btn.textContent = "Optimize";
  }
}

// Handle for scripted checks (headless screenshots, OBS macros). Not an API.
window.gpusim = { state, setFace, setNet, setView, setMobileTab, changed, loadBuild, respace, solveNow };

boot();
