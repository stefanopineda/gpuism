/* Resistor-network view, kept readable: every element shows a short name and
 * one number; everything else is on hover or in the expanders underneath.
 * Layer 1: airflow (fans push air through resistances; pressure ≈ voltage,
 * flow ≈ current). Layer 2: heat (each card's heat crosses thermal
 * resistances into the air layer 1 delivers). */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const kfmt = (k) => (k == null ? "∞" : k >= 1e4 ? k.toExponential(1) : k.toFixed(0));
const cfm = (v) => `${Math.abs(v).toFixed(0)} CFM`;

const FAN_KINDS = new Set(["fan", "shroud-fan", "radiator", "cpu-cooler"]);
const CARD_KINDS = new Set(["gap", "blower", "gpu-fan", "bracket", "recirc", "up-exit", "stack", "plume-ingest"]);

/* Short, plain names for what each branch is. */
function shortName(g) {
  const face = (/^(?:mount|leak)-([a-z_]+)/.exec(g.id)?.[1] || "").replace("_", " ");
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  switch (g.kind) {
    case "fan":
      return g.id === "psu-fan" ? "PSU fan" : `${cap(face)} fan${g.count > 1 ? `s ×${g.count}` : ""}`;
    case "blank":
      return `${cap(face)} cover plate${g.count > 1 ? `s ×${g.count}` : ""}`;
    case "orifice":
      return `${cap(face)} open hole${g.count > 1 ? `s ×${g.count}` : ""}`;
    case "leak":
      return `${cap(face)} panel gaps`;
    case "sealed":
      return `${cap(face)} sealed (∞)`;
    case "radiator":
      return "Radiator + fans";
    case "spill":
      return "GPU zone → case";
    case "cpu-cooler":
      return "CPU cooler";
    case "cpu-exit":
      return "Cooler outlet";
    case "plume":
      return "Plume → room";
    case "rear-slot":
      return "Open rear slots";
    case "reingest":
      return "Slots ↔ exhaust plume";
    case "shroud-fan":
      return "Shroud fans";
    case "shroud-leak":
      return "Shroud leak";
    default:
      return g.kind;
  }
}

function groupBranches(branches) {
  const groups = new Map();
  branches.forEach((br) => {
    const panel = /^(?:mount|leak)-([a-z_]+)/.exec(br.id)?.[1] || br.kind;
    const key = `${br.kind}|${br.a}|${br.b}|${panel}`;
    if (!groups.has(key)) groups.set(key, { ...br, count: 0, flow_total: 0, members: [] });
    const g = groups.get(key);
    g.count += 1;
    g.flow_total += br.flow_cfm;
    g.members.push(br);
  });
  return [...groups.values()];
}

function tipFor(g) {
  const sealed = g.kind === "sealed";
  const isFan = FAN_KINDS.has(g.kind) || g.fan;
  const flow = g.count > 1 ? g.flow_total : g.flow_cfm;
  const law = sealed
    ? "Solid glass or metal (seal 5): no opening, infinite resistance, no air."
    : isFan
      ? `Fan: pressure source on its P–Q curve, P_a − P_b = k·Q·|Q| − P_fan(Q); k = ${kfmt(g.k)} Pa/(m³/s)².`
      : `Resistance: ΔP = k·Q·|Q|, k = ${kfmt(g.k)} Pa/(m³/s)².`;
  const members = g.count > 1 ? ` ${g.count} in parallel: ${g.members.map((m) => `${m.id} ${m.flow_cfm.toFixed(1)} CFM`).join(", ")}.` : "";
  return `${g.role || g.kind}. ${g.label}. ${law} Flow ${Math.abs(flow).toFixed(1)} CFM${g.dp_pa == null || sealed ? "" : `, ΔP ${Math.abs(g.dp_pa).toFixed(1)} Pa`}.${members}`;
}

export function renderNetwork(el, ctx) {
  const { solution: sol, fmt, presets } = ctx;
  if (!sol || sol.error || !sol.branches) {
    el.innerHTML = `<p class="warn">${esc(sol?.error || "Solving…")}</p>`;
    return;
  }
  const names = Object.fromEntries((presets?.cards || []).map((c) => [c.id, c.name.replace(/^NVIDIA (GeForce )?/, "")]));
  el.innerHTML = `
    <div class="net-head">
      <h2>How the number is made</h2>
      <p><b>1 · Airflow:</b> fans push air through resistances (pressure ≈ voltage, flow ≈ current).
      <b>2 · Heat:</b> each card's heat crosses thermal resistances into the air from step 1.
      The two are solved together. <span class="hint">Hover any part for its numbers and assumptions.</span></p>
      <details class="net-more"><summary>How it works</summary>
        <p>Every airflow branch obeys <code>ΔP = k·Q·|Q|</code>; an opening's <code>k = ρ / (2 C<sub>d</sub>² A²)</code>.
        A fan adds pressure along its curve, scaled by speed (<code>Q ∝ N</code>, <code>P ∝ N²</code>), and works against the
        pressure it sees. Air mass balances at every node (Kirchhoff's current law).</p>
        <p>For heat, the air flow through each card's fins sets <code>R_conv = 1 / (ε·ṁ·c<sub>p</sub>)</code>
        (ε-NTU, <code>Nu = C·Re<sup>m</sup>·Pr<sup>1/3</sup></code>). Then
        <code>T_die = T_inlet + Q_fins·R_conv + P_die·R_tim</code>. Temperatures set each GPU fan's speed and the air density,
        and step 1 is solved again until both settle.</p>
        <p>Flow-through cards blow their exhaust up into the card above. The share it swallows (the plume) comes from the
        jet speed, the case crossflow and entrainment; touching cards also share a direct duct.</p>
      </details>
    </div>
    <div class="net-legend">${legend()}</div>
    <section class="net-layer"><h3>1 · Airflow <span class="fine">CFM on each branch, °C at each node</span></h3>${airflowSvg(sol)}</section>
    <section class="net-layer"><h3>2 · Heat, per card <span class="fine">air temperature → die temperature</span></h3>${thermalRows(sol, fmt, names)}</section>
    <details class="net-more"><summary>Every airflow branch (${sol.branches.length})</summary>${branchTable(sol)}</details>
    <details class="net-more"><summary>Every card's heat path, with the math</summary>${thermalTable(sol, fmt, names)}</details>
    <p class="fine net-foot">Mass balance residual ${sol.residual_kg_s.toExponential(1)} kg/s · energy in vs out ${(sol.energy_error * 100).toFixed(3)} %.</p>`;
}

function legend() {
  const item = (svg, text, tip) => `<span data-tip="${esc(tip)}"><svg class="net-sym" width="34" height="18" viewBox="-17 -9 34 18">${svg}</svg>${text}</span>`;
  return [
    item(fanSym("in"), "fan (pushes air)", "A fan is a pressure source: it pushes air along its pressure–flow curve and moves less air against higher pressure."),
    item(resSym(), "resistance", "Anything air squeezes through: panel gaps, filters, slot gaps, fins, bracket vents. ΔP = k·Q·|Q|."),
    item(`<text y="5" text-anchor="middle" class="inf">∞</text>`, "sealed", "Solid glass or metal: no opening, infinite resistance."),
    item(`<path d="M-15,0 L15,0" class="plume-path"/>`, "plume", "Hot exhaust a flow-through card blows into the card above it."),
    item(`<path d="M-15,0 L15,0" class="duct-path"/>`, "duct", "Touching flow-through cards: the lower card's exhaust goes straight into the fans above."),
  ].join("");
}

function resSym() {
  return `<rect x="-15" y="-6" width="30" height="12" class="sym-bg"/><polyline points="-15,0 -11,-5 -6,5 -1,-5 4,5 9,-5 15,0" class="sym"/>`;
}

function fanSym(dir) {
  return `<circle r="8" class="sym-bg"/><circle r="8" class="sym fan ${dir}"/><path d="M-4,0 L4,0 M1,-3 L4,0 L1,3" class="sym fan ${dir}"/>`;
}

/* ------------------------------------------------------------------ layer 1 */

function airflowSvg(sol) {
  const cards = sol.cards || [];
  // Plugged mounts with no flow add nothing to the picture; they stay in the table.
  const groups = groupBranches(sol.branches.filter((b) => !CARD_KINDS.has(b.kind) && !(b.kind === "blank" && Math.abs(b.flow_cfm) < 0.5)));
  const nodes = new Set(sol.branches.flatMap((b) => [b.a, b.b]));
  const W = 1000;
  const railL = 34;
  const railR = W - 34;
  const lane = 40;
  // Room-side branches get their own lane, counted per node and side first.
  const rail = {};
  groups.forEach((g) => {
    if (g.a !== "amb" && g.b !== "amb") return;
    g._inner = g.a === "amb" ? g.b : g.a;
    const text = `${g.id} ${g.label}`.toLowerCase();
    g._side = /front|bottom|side/.test(text) && !/rear/.test(text) && g.kind !== "plume" ? "L" : "R";
    (rail[`${g._inner}|${g._side}`] ||= []).push(g);
  });
  const count = (n, s) => rail[`${n}|${s}`]?.length || 0;
  // GPU-zone branches that leave toward the right (rear) run along the bottom,
  // under the cards, instead of cutting across them.
  const bottomRail = rail["gpu|R"] || [];
  delete rail["gpu|R"];
  const pos = { case: { x: 600, y: 56 } };
  // Main case lanes run right from the case node; the left side starts one lane
  // down so the zone → case line has the top row to itself.
  const caseLanes = Math.max(count("case", "R"), count("case", "L") + 1, 1);
  if (nodes.has("cpu")) pos.cpu = { x: 820, y: 56 + caseLanes * lane + 10 };
  const topBand = nodes.has("cpu") ? pos.cpu.y + (count("cpu", "R") + 1) * lane + 10 : 56 + caseLanes * lane;
  const rowH = 70;
  const top = topBand + 50;
  cards.forEach((c, i) => {
    pos[`cin-${c.id}`] = { x: 420, y: top + i * rowH };
    pos[`cex-${c.id}`] = { x: 660, y: top + i * rowH };
  });
  const midY = top + ((Math.max(cards.length, 1) - 1) * rowH) / 2;
  pos.gpu = { x: 250, y: midY };
  const sink = nodes.has("plenum") ? "plenum" : nodes.has("plume") ? "plume" : null;
  if (sink) pos[sink] = { x: 820, y: midY };
  const bottom = top + (cards.length - 1) * rowH + 56;
  const bottomLanes = bottomRail.length + (sol.branches.some((b) => b.kind === "rear-slot" && b.b !== "amb") ? 1 : 0) + (sol.branches.some((b) => b.kind === "reingest") ? 1 : 0);
  const H = Math.max(bottom + Math.max(bottomLanes, 1) * lane + 20, midY + (count("gpu", "L") / 2 + 1) * lane + 30);

  const out = [];
  out.push(`<line x1="${railL}" y1="20" x2="${railL}" y2="${H - 6}" class="rail"/><line x1="${railR}" y1="20" x2="${railR}" y2="${H - 6}" class="rail"/>`);
  out.push(`<text x="${railL - 6}" y="13" class="rail-t">room</text><text x="${railR + 6}" y="13" class="rail-t" text-anchor="end">room</text>`);

  const used = {};
  const labelled = (g, pts, seg, name) => {
    const a = pts[seg];
    const b = pts[seg + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const sealed = g.kind === "sealed";
    const isFan = FAN_KINDS.has(g.kind) || g.fan;
    const flow = g.count > 1 ? g.flow_total : g.flow_cfm;
    const width = sealed ? 1.5 : Math.min(1.2 + Math.abs(flow) / 30, 5);
    const forward = (g.flow_m3s ?? 0) >= 0;
    const intake = g.a === "amb" ? forward : !forward;
    const sym = sealed ? `<text y="5" text-anchor="middle" class="inf">∞</text>` : isFan ? fanSym(intake ? "in" : "out") : resSym();
    const [p, q] = forward ? [a, b] : [b, a];
    const arrow = sealed || Math.abs(flow) < 0.5 ? "" : `<path d="M${p.x + (q.x - p.x) * 0.78},${p.y + (q.y - p.y) * 0.78} L${p.x + (q.x - p.x) * 0.84},${p.y + (q.y - p.y) * 0.84}" class="flowdir" marker-end="url(#arr)"/>`;
    const text = sealed ? name : `${name} · ${cfm(flow)}`;
    return `<g class="branch" data-tip="${esc(tipFor(g))}">
      <path d="M${pts.map((pt) => `${pt.x},${pt.y}`).join(" L")}" class="wire ${sealed ? "sealed" : ""}" style="stroke-width:${width}"/>${arrow}
      <g transform="translate(${mx},${my})">${sym}</g>
      <text x="${mx}" y="${my - 12}" text-anchor="middle" class="br-t">${esc(text)}</text></g>`;
  };

  let bottomUsed = 0;
  const bottomLane = () => bottom + (bottomUsed++) * lane;
  bottomRail.forEach((g) => {
    const y = bottomLane();
    const a = pos.gpu;
    const pts = [a, { x: a.x, y }, { x: railR, y }];
    out.push(labelled(g, g.a === "amb" ? pts.slice().reverse() : pts, 1, shortName(g)));
    g._done = true;
  });
  groups.forEach((g) => {
    if (g._done) return;
    if (g._inner) {
      const pn = pos[g._inner];
      if (!pn) return;
      const key = `${g._inner}|${g._side}`;
      const n = rail[key].length;
      const k = (used[key] = (used[key] ?? -1) + 1);
      const down = g._inner === "case" || g._inner === "cpu";
      const offset = (g._inner === "case" && g._side === "L") || g._inner === "cpu" ? 1 : 0;
      const y = down ? pn.y + (k + offset) * lane : pn.y + (k - (n - 1) / 2) * lane;
      const railX = g._side === "L" ? railL : railR;
      const elbow = pn.x + (g._side === "L" ? -40 : 40);
      const pts = [pn, { x: elbow, y }, { x: railX, y }];
      out.push(labelled(g, g.a === "amb" ? pts.slice().reverse() : pts, g.a === "amb" ? 0 : 1, shortName(g)));
      return;
    }
    const a = pos[g.a];
    const b = pos[g.b];
    if (!a || !b) return;
    if (g.kind === "spill") {
      out.push(labelled(g, [a, { x: a.x, y: pos.case.y }, b], 1, shortName(g)));
    } else if (g.kind === "rear-slot" || g.kind === "reingest") {
      const y = bottomLane();
      out.push(labelled(g, [a, { x: a.x, y }, { x: b.x, y }, b], 1, shortName(g)));
    } else if (g.kind === "cpu-cooler") {
      out.push(labelled(g, [a, { x: a.x, y: b.y }, b], 1, shortName(g)));
    } else if (g.kind === "cpu-exit") {
      out.push(labelled(g, [a, { x: a.x, y: a.y + 24 }, { x: pos.case.x + 30, y: a.y + 24 }, { x: pos.case.x + 30, y: b.y }, b], 1, shortName(g)));
    } else {
      out.push(labelled(g, [a, b], 0, shortName(g)));
    }
  });

  // Card rows: slot gap → GPU (fans + fins) → bracket; exhaust paths up or back.
  const plumeByUpper = Object.fromEntries((sol.plume || []).map((p) => [p.upper, p]));
  cards.forEach((c, i) => {
    const cin = pos[`cin-${c.id}`];
    const cex = pos[`cex-${c.id}`];
    const mine = sol.branches.filter((b) => [b.a, b.b].some((n) => n === `cin-${c.id}` || n === `cex-${c.id}`));
    const byKind = (k) => mine.filter((b) => b.kind === k);
    const gaps = byKind("gap");
    const gapFlow = gaps.reduce((s, b) => s + b.flow_cfm, 0);
    const gapTip = `Slot gap into GPU ${i + 1}'s fans: ${gaps.map((b) => `${b.label}, ${b.flow_cfm.toFixed(1)} CFM, k ${kfmt(b.k)}`).join("; ")}. Tight gaps starve the fan.`;
    out.push(`<g class="branch" data-tip="${esc(gapTip)}"><path d="M${pos.gpu.x},${pos.gpu.y} C${pos.gpu.x + 90},${pos.gpu.y} ${cin.x - 90},${cin.y} ${cin.x},${cin.y}" class="wire" style="stroke-width:${Math.min(1.2 + gapFlow / 30, 4)}"/></g>`);
    const fanBr = mine.find((b) => b.kind === "blower" || b.kind === "gpu-fan");
    const fanTip = fanBr ? `${fanBr.label}: ${fanBr.flow_cfm.toFixed(1)} CFM, fin-channel k ${kfmt(fanBr.k)}, ΔP ${fanBr.dp_pa.toFixed(1)} Pa. Fan at ${Math.round(c.duty * 100)} % speed.` : "";
    out.push(
      `<g class="card-box" data-tip="${esc(fanTip)}"><rect x="${cin.x + 14}" y="${cin.y - 20}" width="${cex.x - cin.x - 28}" height="40" rx="7"/>` +
        `<text x="${(cin.x + cex.x) / 2}" y="${cin.y - 3}" text-anchor="middle" class="card-t">GPU ${i + 1}</text>` +
        `<text x="${(cin.x + cex.x) / 2}" y="${cin.y + 13}" text-anchor="middle" class="card-v">${c.flow_cfm.toFixed(0)} CFM${plumeByUpper[c.id]?.mass_kg_s > 0 ? ` · ${Math.round(plumeByUpper[c.id].share_of_upper_intake * 100)} % from GPU ${i + 2}` : ` · ${c.cooler === "flow_through" ? "flow-through" : "blower"}`}</text></g>`,
    );
    out.push(`<circle cx="${cin.x}" cy="${cin.y}" r="4" class="dot"/><circle cx="${cex.x}" cy="${cex.y}" r="4" class="dot"/>`);
    const bracket = byKind("bracket")[0];
    if (bracket && sink) {
      out.push(`<g class="branch" data-tip="${esc(`${bracket.label}: ${bracket.flow_cfm.toFixed(1)} CFM, k ${kfmt(bracket.k)}.`)}"><path d="M${cex.x},${cex.y} C${cex.x + 70},${cex.y} ${pos[sink].x - 70},${pos[sink].y} ${pos[sink].x},${pos[sink].y}" class="wire" style="stroke-width:${Math.min(1.2 + Math.abs(bracket.flow_cfm) / 30, 4)}"/></g>`);
    }
    const up = byKind("up-exit")[0];
    if (up) {
      out.push(`<g class="branch" data-tip="${esc(`${up.label}: ${up.flow_cfm.toFixed(1)} CFM rising into the upper case.`)}"><path d="M${cex.x},${cex.y} C${cex.x + 40},${cex.y - 30} ${pos.case.x + 20},${pos.case.y + 40} ${pos.case.x},${pos.case.y}" class="wire thin"/></g>`);
    }
    const back = byKind("recirc")[0];
    if (back) {
      out.push(`<g class="branch" data-tip="${esc(`${back.label}: ${back.flow_cfm.toFixed(1)} CFM leaking back into the GPU zone around the bracket.`)}"><path d="M${cex.x},${cex.y} C${cex.x},${cex.y + 30} ${pos.gpu.x + 60},${pos.gpu.y + 40} ${pos.gpu.x},${pos.gpu.y}" class="wire thin faint"/></g>`);
    }
    const duct = sol.branches.find((b) => b.kind === "stack" && b.b === `cin-${c.id}`);
    if (duct && pos[duct.a]) {
      const from = pos[duct.a];
      const gy = (from.y + cin.y) / 2 + 3;
      out.push(`<g class="branch" data-tip="${esc(`${duct.label}: ${duct.flow_cfm.toFixed(1)} CFM straight from the card below into this card's fans.`)}"><path d="M${from.x - 40},${from.y - 20} L${from.x - 40},${gy} L${cin.x + 40},${gy} L${cin.x + 40},${cin.y + 20}" class="duct-path"/></g>`);
    }
    const plume = plumeByUpper[c.id];
    if (plume && plume.mass_kg_s > 0 && pos[plume.from_node]) {
      const from = pos[plume.from_node];
      const tip = `Plume: GPU ${i + 1} draws ${(plume.share_of_upper_intake * 100).toFixed(0)} % of its intake from the exhaust of the card below (${plume.flow_cfm.toFixed(1)} CFM at ${plume.t_from_c?.toFixed(1)} °C). ` +
        `Jet ${plume.jet_velocity_m_s?.toFixed(2)} m/s, crossflow ${plume.crossflow_m_s?.toFixed(2)} m/s, ${(plume.swept_fraction * 100).toFixed(0)} % swept away, ${(plume.entrained_ratio * 100).toFixed(0)} % room air entrained over the ${plume.gap_mm.toFixed(0)} mm gap.`;
      const gy = (from.y + cin.y) / 2 - 3;
      out.push(`<g class="branch" data-tip="${esc(tip)}"><path d="M${from.x - 24},${from.y - 20} L${from.x - 24},${gy} L${cin.x + 24},${gy} L${cin.x + 24},${cin.y + 20}" class="plume-path"/></g>`);
    }
  });

  const nodeName = { gpu: "GPU zone", case: "Main case", cpu: "CPU cooler", plenum: "Shroud", plume: "Rear exhaust" };
  Object.entries(pos).forEach(([name, p]) => {
    if (!nodeName[name]) return;
    const T = sol.node_temp?.[name];
    const P = sol.pressures?.[name];
    const tip = `${nodeName[name]} air: ${T?.toFixed(1)} °C, ${P >= 0 ? "+" : ""}${P?.toFixed(1)} Pa relative to the room. Air in = air out.`;
    const sideLanes = name === "gpu" ? count("gpu", "L") : name === sink ? count(sink, "R") : 0;
    const ty = sideLanes ? p.y + (sideLanes / 2) * lane + 14 : name === "cpu" ? p.y + 5 : p.y - 16;
    const tx = name === "gpu" ? p.x - 60 : name === sink ? p.x + 70 : name === "cpu" ? p.x + 44 : p.x;
    out.push(
      `<g class="node" data-tip="${esc(tip)}"><circle cx="${p.x}" cy="${p.y}" r="9"/>` +
        `<text x="${tx}" y="${ty}" text-anchor="middle" class="node-t">${name === "cpu" ? `${T?.toFixed(1)} °C` : `${nodeName[name]} · ${T?.toFixed(1)} °C`}</text></g>`,
    );
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="net-svg" preserveAspectRatio="xMidYMin meet">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>
    ${out.join("")}</svg>`;
}

/* ------------------------------------------------------------------ layer 2 */

function thermalRows(sol, fmt, names) {
  return `<div class="heat-rows">${(sol.cards || [])
    .map((c, i) => {
      const d = c.thermal || {};
      const tIn = d.t_inlet_used_c ?? c.t_in_c;
      const duct = sol.branches.find((b) => b.kind === "stack" && b.b === `cin-${c.id}` && b.flow_cfm > 1);
      const share = duct ? Math.min(1, duct.flow_cfm / Math.max(c.flow_cfm, 1e-6)) : 0;
      const plume = duct
        ? `${Math.round(share * 100)} % straight from the card below`
        : d.plume_from
          ? `+${Math.round(d.plume_share_of_intake * 100)} % exhaust from below`
          : "zone air";
      const chip = (label, t, tip, cls = "") => `<span class="chip ${cls}" data-tip="${esc(tip)}"><small>${label}</small><b>${fmt(t)}</b></span>`;
      const link = (label, tip) => `<span class="link" data-tip="${esc(tip)}">${label}</span>`;
      const rConv = d.r_conv_k_per_w;
      return `<div class="heat-row">
        <span class="heat-name" data-tip="${esc(`${names[c.card] || c.card}, slot ${c.slot}, ${c.power_w.toFixed(0)} W.`)}">GPU ${i + 1}</span>
        ${chip("zone air", d.t_zone_c, `GPU-zone air from layer 1: ${d.t_zone_c?.toFixed(2)} °C.`)}
        ${link(plume, `Inlet air = zone air${d.plume_from ? `, ${Math.round(d.plume_share_of_intake * 100)} % of it replaced by exhaust from the card below at ${d.plume_source_temp_c?.toFixed(1)} °C` : ""}, plus ${d.inlet_heat_captured_w?.toFixed(1)} W from neighbouring backplates.`)}
        ${chip("inlet", tIn, `Air entering the fans: ${tIn?.toFixed(2)} °C.`)}
        ${link(rConv == null ? "no airflow" : `R<sub>conv</sub> ${rConv.toFixed(3)} K/W`, `Fins to air: R_conv = 1/(ε·ṁ·c_p) = 1/(${d.epsilon?.toFixed(2)} × ${((d.mass_kg_s || 0) * 1000).toFixed(1)} g/s × 1007) = ${rConv?.toFixed(3)} K/W, carrying ${d.q_channel_w?.toFixed(0)} W. ṁ comes from layer 1 (${c.flow_cfm.toFixed(1)} CFM). A parallel ${d.r_ext_k_per_w?.toFixed(1)} K/W path sheds ${d.q_ext_w?.toFixed(1)} W off the shroud and backplate.`)}
        ${chip("heatsink", d.t_heatsink_c, `Heatsink metal, ${d.t_heatsink_c?.toFixed(1)} °C.`)}
        ${link(`R<sub>tim</sub> ${d.r_tim_k_per_w} K/W`, `Die to heatsink (paste + spreading): ${d.r_tim_k_per_w} K/W carrying ${d.p_die_w?.toFixed(0)} W. Memory: ${d.r_mem_k_per_w} K/W, ${d.p_mem_w?.toFixed(0)} W → ${fmt(c.t_mem_c)}.`)}
        ${chip("die", d.t_die_c, `T_die = T_in + Q_fins·R_conv + P_die·R_tim = ${tIn?.toFixed(1)} + ${d.q_channel_w?.toFixed(0)}×${rConv?.toFixed(3)} + ${d.p_die_w?.toFixed(0)}×${d.r_tim_k_per_w} = ${d.t_die_c?.toFixed(1)} °C${c.throttle ? " (throttled result)" : ""}.`, "die")}
      </div>`;
    })
    .join("")}</div>`;
}

/* ------------------------------------------------------------------ tables */

function branchTable(sol) {
  const rows = sol.branches
    .filter((b) => b.kind !== "bleed")
    .map(
      (b) =>
        `<tr><td>${esc(b.label)}</td><td>${esc(b.role || b.kind)}</td><td class="num">${kfmt(b.k)}</td><td class="num">${b.flow_cfm.toFixed(1)}</td><td class="num">${b.dp_pa == null ? "—" : b.dp_pa.toFixed(1)}</td></tr>`,
    )
    .join("");
  return `<table class="net-table"><tr><th>Branch</th><th>What it is</th><th>k, Pa/(m³/s)²</th><th>CFM</th><th>ΔP, Pa</th></tr>${rows}</table>`;
}

function thermalTable(sol, fmt, names) {
  const rows = (sol.cards || [])
    .map((c, i) => {
      const d = c.thermal || {};
      const tIn = d.t_inlet_used_c ?? c.t_in_c;
      return `<tr><td>GPU ${i + 1}<br><span class="fine">${esc(names[c.card] || c.card)}</span></td>
        <td class="num">${fmt(d.t_zone_c)}</td><td class="num">${d.plume_from ? `${Math.round(d.plume_share_of_intake * 100)} %` : "—"}</td>
        <td class="num">${fmt(tIn)}</td><td class="num">${((d.mass_kg_s || 0) * 1000).toFixed(1)}</td><td class="num">${d.epsilon?.toFixed(2)}</td>
        <td class="num">${d.r_conv_k_per_w?.toFixed(3) ?? "∞"}</td><td class="num">${d.q_channel_w?.toFixed(0)} / ${d.q_ext_w?.toFixed(0)}</td>
        <td class="num">${fmt(d.t_heatsink_c)}</td><td class="num">${d.r_tim_k_per_w}</td><td class="num">${fmt(d.t_die_c)}</td><td class="num">${fmt(c.t_mem_c)}</td></tr>
        <tr class="eq-row"><td></td><td colspan="11"><code>T_die = ${tIn?.toFixed(1)} + ${d.q_channel_w?.toFixed(0)} × ${d.r_conv_k_per_w?.toFixed(3)} + ${d.p_die_w?.toFixed(0)} × ${d.r_tim_k_per_w} = ${d.t_die_c?.toFixed(1)} °C</code></td></tr>`;
    })
    .join("");
  return `<table class="net-table"><tr><th>Card</th><th>Zone air</th><th>Plume</th><th>Inlet</th><th>ṁ, g/s</th><th>ε</th><th>R_conv K/W</th><th>Fins / shell W</th><th>Heatsink</th><th>R_tim K/W</th><th>Die</th><th>Memory</th></tr>${rows}</table>`;
}
