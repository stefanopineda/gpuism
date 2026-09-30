/* 3D case view. Case frame in mm: x = depth (0 front → D rear), y = height
 * (0 floor → H top), z = width (0 motherboard tray → W glass side). The scene
 * works in metres. The root group is mirrored in x so that, looking through
 * the glass, the front of the case is on the right and the rear I/O on the
 * left — the way a real ATX board sits.
 *
 * Parts are drawn as the real hardware (PBR materials lit by a studio
 * environment, soft shadows; see parts.js). Colour is kept only as a cue: a
 * lit ring on each fan (blue intake, red exhaust, amber internal) and a light
 * bar on each GPU in its die-temperature colour. No text is drawn over the
 * scene; hovering an object reports it instead. */
import * as THREE from "./vendor/three.module.js?v=0e630ccea8-a2ae7e58";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js?v=0e630ccea8-a2ae7e58";
import {
  CUE,
  MAT,
  coverPlate,
  cpuAreaModel,
  fanModel,
  gpuModel,
  isShared,
  meshPanelMaterial,
  motherboardModel,
  openHole,
  orient,
  psuModel,
  radiatorModel,
  tag,
  tube,
} from "./parts.js?v=0e630ccea8-a2ae7e58";

const VIEWS = {
  front34: new THREE.Vector3(0.62, 0.38, 1.0),
  side: new THREE.Vector3(0, 0.08, 1.0),
  rear34: new THREE.Vector3(-0.7, 0.4, 1.0),
};

const RADIATOR_PANELS = ["front", "top", "bottom"];
const FEET = 0.014;
const m = (mm) => mm / 1000;

/* Noctua redux fans are grey; everything else is drawn black. */
const fanStyle = (fan) => (/redux/i.test(`${fan?.id || ""} ${fan?.name || ""}`) ? "grey" : "black");

export class CaseScene {
  constructor(canvas, labelsEl, callbacks = {}) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.cb = callbacks;
    this.view = "front34";
    this._setDir(VIEWS.front34);
    this.zoom = 1;
    this.orbit = null;
    this.ctx = null;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // parts only move on update()
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0d0e10");
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(r), 0.04).texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 30);
    this.scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x1a1712, 0.35));
    // Key light from above the glass, front side; it throws the shadows.
    this.key = new THREE.DirectionalLight(0xfff4e8, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.0015;
    this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target);
    // Cool rim from behind the tray so dark parts keep an edge.
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.6);
    rim.position.set(-2, 1.5, -3);
    this.scene.add(rim);
    // Floor: matte, catches the case's shadow.
    // Radial fade so the floor melts into the background instead of ending
    // at a hard horizon.
    const fade = document.createElement("canvas");
    fade.width = fade.height = 256;
    const g = fade.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "#8a8a8a");
    grad.addColorStop(1, "#000000");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const floorFade = new THREE.CanvasTexture(fade);
    floorFade.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshLambertMaterial({ color: 0x2a2b2e, map: floorFade }),
    );
    this.floor = floor;
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.root = new THREE.Group();
    this.root.scale.x = -1; // front on the right as seen through the glass
    this.root.position.y = FEET;
    this.scene.add(this.root);
    this.drag = null;
    this.labels = [];
    const viewBox = canvas.closest("#view3d") || canvas.parentElement;
    // Pointer listeners sit on the view so a finger on the canvas or an overlay
    // both orbit. Touch listeners stay on the canvas: iOS only cancels the
    // scroll if preventDefault runs on the touched element, non-passive.
    const pointerTarget = viewBox || canvas;
    pointerTarget.addEventListener("pointerdown", (ev) => this._down(ev));
    pointerTarget.addEventListener("pointerup", (ev) => this._up(ev));
    pointerTarget.addEventListener("pointercancel", () => this._cancelPointer());
    pointerTarget.addEventListener("pointermove", (ev) => (this.orbit ? this._orbitMove(ev) : this._hover(ev)));
    canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        this.zoom = Math.min(2.5, Math.max(0.35, this.zoom * Math.pow(1.0015, ev.deltaY)));
        this._frame();
      },
      { passive: false },
    );
    const blockScroll = (ev) => {
      if (ev.cancelable) ev.preventDefault();
    };
    canvas.addEventListener("touchstart", blockScroll, { passive: false });
    canvas.addEventListener("touchmove", blockScroll, { passive: false });
    if (viewBox && viewBox !== canvas) {
      viewBox.addEventListener("touchstart", blockScroll, { passive: false });
      viewBox.addEventListener("touchmove", blockScroll, { passive: false });
    }
    canvas.addEventListener("dblclick", () => this.setView(this.view));
    pointerTarget.addEventListener("pointerleave", () => this.cb.onHover?.(null));
    if (viewBox && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(viewBox);
    }
    const loop = () => {
      this._resize();
      this.renderer.render(this.scene, this.camera);
      this._placeLabels();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* Force a camera fit. Called after the PC tab is actually on screen. */
  relayout() {
    this._resize(true);
  }

  setView(name) {
    if (VIEWS[name]) {
      this.view = name;
      this._setDir(VIEWS[name]);
      this.zoom = 1;
    }
    this._frame();
  }

  /* Camera direction as azimuth (around the vertical axis) and elevation. */
  _setDir(v) {
    const d = v.clone().normalize();
    this.az = Math.atan2(d.x, d.z);
    this.el = Math.asin(d.y);
  }

  _dir() {
    return new THREE.Vector3(Math.sin(this.az) * Math.cos(this.el), Math.sin(this.el), Math.cos(this.az) * Math.cos(this.el));
  }

  update(ctx) {
    this.ctx = ctx;
    while (this.root.children.length) {
      const child = this.root.children.pop();
      child.traverse?.((o) => {
        if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((mat) => {
          if (isShared(mat)) return;
          ["map", "alphaMap"].forEach((k) => mat[k] && !isShared(mat[k]) && mat[k].dispose());
          mat.dispose();
        });
      });
    }
    this.labels = [];
    if (!ctx || !ctx.build || !ctx.kase) return;
    const { W, H, D } = this._dims();
    this.root.position.x = D;
    this._shell();
    this._internals();
    this._mounts();
    this._rm52Cage();
    this._radiator();
    this._gpus();
    this._shroud();
    // Lights follow the case (world x = D − local x; the mirror keeps D/2).
    const c = new THREE.Vector3(D / 2, FEET + H / 2, W / 2);
    this.key.target.position.copy(c);
    this.floor.position.set(D / 2, 0, W / 2);
    this.key.position.copy(c).add(new THREE.Vector3(0.55, 1.3, 1.1));
    const cam = this.key.shadow.camera;
    const span = Math.max(W, H, D) * 0.85;
    Object.assign(cam, { left: -span, right: span, top: span, bottom: -span, near: 0.2, far: 4 });
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this._frame();
  }

  /* Add a part: every mesh in it carries the same hover / pick data. */
  _add(object, userData = {}) {
    tag(object, userData);
    this.root.add(object);
    return object;
  }

  /* ------------------------------------------------------------ geometry */

  _dims() {
    const k = this.ctx.kase;
    return { W: m(k.width_mm), H: m(k.height_mm), D: m(k.depth_mm) };
  }

  /* Steel chassis: solid tray, floor and rear; perforated front and top;
   * a tempered-glass side (or mesh, if the case has a mesh side panel). */
  _shell() {
    const { W, H, D } = this._dims();
    const t = 0.0012;
    const panel = (w, h, mat, pos, rot, shadow = false) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      p.position.copy(pos);
      p.rotation.set(...rot);
      p.receiveShadow = shadow;
      this.root.add(p);
      return p;
    };
    const tray = new THREE.Mesh(new THREE.BoxGeometry(D, H, t), MAT.steel);
    tray.position.set(D / 2, H / 2, -t / 2);
    tray.receiveShadow = true;
    this.root.add(tray);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(D, t, W), MAT.steel);
    floor.position.set(D / 2, -t / 2, W / 2);
    floor.receiveShadow = true;
    this.root.add(floor);
    panel(W, H, meshPanelMaterial(W, H, 0.8), new THREE.Vector3(D + t, H / 2, W / 2), [0, Math.PI / 2, 0]);
    panel(W, H, meshPanelMaterial(W, H, 0.92), new THREE.Vector3(-t, H / 2, W / 2), [0, -Math.PI / 2, 0]);
    panel(D, W, meshPanelMaterial(D, W, 0.9), new THREE.Vector3(D / 2, H + t, W / 2), [-Math.PI / 2, 0, 0]);
    const side =
      this.ctx.build.side_panel === "mesh"
        ? meshPanelMaterial(D, H, 0.85)
        : this.ctx.build.side_panel === "steel"
          ? MAT.steel
          : MAT.glass;
    panel(D - 0.02, H - 0.02, side, new THREE.Vector3(D / 2, H / 2, W + t), [0, 0, 0]);
    // Frame rails on all twelve edges, and rubber feet.
    const rail = 0.009;
    const rails = new THREE.Group();
    const beam = (sx, sy, sz, x, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), MAT.steelMid);
      b.position.set(x, y, z);
      rails.add(b);
    };
    for (const y of [0, H]) for (const z of [0, W]) beam(D + rail, rail, rail, D / 2, y, z);
    for (const x of [0, D]) for (const z of [0, W]) beam(rail, H + rail, rail, x, H / 2, z);
    for (const x of [0, D]) for (const y of [0, H]) beam(rail, rail, W + rail, x, y, W / 2);
    for (const x of [0.04, D - 0.04]) {
      for (const z of [0.03, W - 0.03]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, FEET, 24), MAT.rubber);
        foot.position.set(x, -FEET / 2, z);
        rails.add(foot);
      }
    }
    rails.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.root.add(rails);
  }

  _internals() {
    const { build, kase } = this.ctx;
    const { W, H, D } = this._dims();
    const board = this._board();
    const slots = Math.min(7, kase.horizontal_slots);
    const slotYs = [];
    for (let s = 1; s <= slots; s += 1) slotYs.push(this.slotY(s) + 0.004);
    this._add(motherboardModel({ ...board, slotYs }), {
      kind: "part",
      tip: "Motherboard: ASUS Pro WS WRX90E-SAGE SE layout (EEB 12 × 13 in, sTR5 socket, 8 DIMM slots, 7 PCIe 5.0 x16). Proportions, not a drawing.",
    });

    // Socket, RAM and CPU cooler.
    const sx = board.rear - board.depth * 0.46;
    const sy = board.top - 0.085;
    this.socket = new THREE.Vector3(sx, sy, 0.01);
    const cpu = build.cpu || { cooling: "water", power_w: 150 };
    const upward = (cpu.cooler_airflow || "up") === "up";
    const fans = cpu.cooler_fans || "both";
    const cooler = cpuAreaModel({ cooling: cpu.cooling, fans, upward, cue: CUE.internal });
    cooler.position.copy(this.socket);
    const tip =
      cpu.cooling === "air"
        ? `CPU tower cooler, ${Math.round(cpu.power_w)} W into the case air, blowing ${upward ? "up" : "toward the rear"}` +
          `${fans === "both" ? ", push-pull pair" : `, ${fans} fan only`}. sTR5 socket, 8 DDR5 RDIMMs.`
        : `AIO pump on the CPU, ${Math.round(cpu.power_w)} W to the radiator. sTR5 socket, 8 DDR5 RDIMMs.`;
    this._add(cooler, { kind: "part", tip });

    // PSU and its shroud, bottom rear.
    const n = kase.horizontal_slots;
    const lowest = this.slotY(n) - m(kase.slot_pitch_mm);
    const shrouded = kase.psu_shroud && build.psu_location !== "open";
    const shroudTop = Math.max(0.1, Math.min(lowest - m(kase.psu_shroud_clearance_mm || 40), H * 0.36));
    const psuFanUp = build.psu_fan === "up";
    const psu = psuModel(psuFanUp);
    // RM52's ATX bay is drawn at the front. The eight-slot stack fills the rear,
    // and SilverStone does not publish a PSU station. Other cases stay bottom rear.
    const psuAtFront = kase.id === "silverstone-rm52";
    psu.position.set(psuAtFront ? 0.012 + 0.085 : D - 0.012 - 0.085, 0.012 + 0.043, W / 2);
    this._add(psu, {
      kind: "part",
      tip: `PSU, ${psuAtFront ? "front bay (RM52 drawing)" : "bottom rear"}${shrouded ? ", under the PSU shroud" : ""}, fan ${psuFanUp ? "up" : "down"}`,
    });
    if (shrouded) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(D - 0.01, 0.0015, W - 0.01), meshPanelMaterial(D, W, 0.95));
      top.position.set(D / 2, shroudTop, W / 2);
      g.add(top);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.01, shroudTop), MAT.smoke);
      face.position.set(D / 2, shroudTop / 2, W - 0.006);
      g.add(face);
      g.userData = { kind: "part", tip: "PSU shroud: perforated top, closed below" };
      g.traverse((o) => (o.userData = g.userData));
      this.root.add(g);
    }
  }

  /* ASUS Pro WS WRX90E-SAGE SE, EEB 12 × 13 in: schematic placement. */
  _board() {
    const { H } = this._dims();
    const rear = this._bracketX();
    const height = Math.min(0.35, H - 0.1);
    const depth = Math.min(0.33, rear - 0.04);
    return { top: H - 0.025, height, depth, rear };
  }

  /* Expansion-slot brackets. Other cases put them on the rear skin. The RM52's
   * published 605 mm depth includes a 45 mm external fan cage; the brackets are
   * on the main rear panel at 560 mm, and the cage is the empty box behind them. */
  _bracketX() {
    const { D } = this._dims();
    if (this.ctx.kase.id === "silverstone-rm52") return 0.56;
    return D - 0.012;
  }

  /* Slot 1 sits below the socket with room for a ~165 mm tower cooler, about
   * 185 mm under the board's top edge; the board runs on below slot 7. */
  slotY(s) {
    const k = this.ctx.kase;
    const slot1 = Math.min(m(k.top_slot_y_mm), this._board().top - 0.185);
    return slot1 - (s - 1) * m(k.slot_pitch_mm);
  }

  _face(panel, layout) {
    const { W, H, D } = this._dims();
    const x = m(layout.x_mm);
    const y = m(layout.y_mm);
    const z = m(layout.z_mm);
    switch (panel) {
      case "front":
        // x under 80 mm is a skin offset on the other cases (0–40 mm) and stays
        // on the front panel. Farther in is an internal bracket (RM52's second
        // row of three 120 mm positions), drawn where it sits.
        return { pos: new THREE.Vector3(x > 0.08 ? x : 0, y, z), normal: new THREE.Vector3(-1, 0, 0) };
      case "rear":
        // Existing cases set x equal to the depth, so they stay on the rear skin.
        // A smaller x is the RM52 I/O panel, ahead of the external cage. The
        // rotor itself is parked on the cage's outer face in _mounts.
        return { pos: new THREE.Vector3(x > 0 ? x : D, y, z), normal: new THREE.Vector3(1, 0, 0) };
      case "top":
        return { pos: new THREE.Vector3(x, H, z), normal: new THREE.Vector3(0, 1, 0) };
      case "bottom":
        return { pos: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(0, -1, 0) };
      case "side":
        return { pos: new THREE.Vector3(x, y, W), normal: new THREE.Vector3(0, 0, 1) };
      default:
        return { pos: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(1, 0, 0) };
    }
  }

  /* The RM52's external 80 mm cage: a 45 mm box on the main rear panel, behind
   * the slot brackets, covering the card exhaust. The two included 80 mm fans
   * mount on its outer face. */
  _rm52Cage() {
    if (this.ctx.kase.id !== "silverstone-rm52") return;
    const x0 = 0.562;
    const x1 = 0.605;
    const y0 = 0.07;
    const y1 = 0.246;
    const z0 = 0.028;
    const z1 = 0.124;
    const rail = 0.006;
    const g = new THREE.Group();
    const beam = (sx, sy, sz, x, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), MAT.steelMid);
      b.position.set(x, y, z);
      g.add(b);
    };
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    for (const y of [y0, y1]) for (const z of [z0, z1]) beam(dx, rail, rail, cx, y, z);
    for (const x of [x0, x1]) for (const z of [z0, z1]) beam(rail, dy, rail, x, cy, z);
    for (const x of [x0, x1]) for (const y of [y0, y1]) beam(rail, rail, dz, x, y, cz);
    this._add(g, {
      kind: "part",
      tip: "Rear fan cage: 45 mm external box behind the slot brackets, two 80 mm exhausts on the outer face",
    });
  }

  /* A real fan on a panel. `normal` points out of the case. The motor struts
   * sit on the downstream side, as on the hardware. */
  _caseFan(center, normal, sizeM, direction, fan, userData, depth = 0.025) {
    const f = fanModel(sizeM, { cue: CUE[direction] ?? null, style: fanStyle(fan), depth });
    orient(f, direction === "exhaust" ? normal.clone().negate() : normal);
    f.position.copy(center);
    return this._add(f, userData);
  }

  _mounts() {
    const { build, kase, presets } = this.ctx;
    const layouts = activeLayouts(kase, build.patterns);
    const byMount = Object.fromEntries((build.mounts || []).map((mt) => [mt.id, mt]));
    layouts.forEach((layout) => {
      const mount = byMount[layout.id] || { id: layout.id, state: "blanked" };
      if (mount.state === "radiator") return;
      // An unused side-wall mount is just glass: draw nothing.
      if (layout.panel === "side" && mount.state !== "fan") return;
      const { pos, normal } = this._face(layout.panel, layout);
      const size = m(layout.size_mm);
      const fan = presets.fans.find((f) => f.id === mount.fan);
      const tip =
        mount.state === "fan"
          ? `${cap(layout.panel)} fan: ${fan ? fan.name : mount.fan} · ${mount.direction} · ${Math.round((mount.duty ?? 1) * 100)} % speed`
          : mount.state === "empty"
            ? `${cap(layout.panel)} ${layout.size_mm} mm mount: open hole, no fan`
            : `${cap(layout.panel)} ${layout.size_mm} mm mount: cover plate (plugged)`;
      const ud = { kind: "fan", id: mount.id, panel: layout.panel, tip };
      let obj;
      if (mount.state === "fan") {
        // Other cases sink the rotor one frame-depth inside the skin. On the RM52
        // the same pull puts the rear I/O fan inside the card length, so from the
        // glass it reads as a wall across the heatsinks. Rear rotors stay on the
        // outer face of the cage, behind the 560 mm brackets.
        let center = pos.clone().addScaledVector(normal, -0.0155);
        if (kase.id === "silverstone-rm52" && layout.panel === "rear") {
          // 25 mm rotor, outer face flush with the 605 mm cage back.
          center = pos.clone();
          center.x = 0.592;
        }
        obj = this._caseFan(center, normal, size * 0.98, mount.direction, fan, ud);
      } else {
        obj = mount.state === "empty" ? openHole(size) : coverPlate(size);
        orient(obj, normal);
        obj.position.copy(pos.clone().addScaledVector(normal, -0.003));
        this._add(obj, ud);
      }
      if (this.ctx.selectedMount === mount.id) obj.scale.setScalar(1.08);
    });
  }

  _radiator() {
    const { build, kase, presets } = this.ctx;
    const rad = build.radiator;
    if (!rad || !rad.model) return;
    const model = presets.radiators.find((r) => r.id === rad.model);
    if (!model) return;
    const panel = RADIATOR_PANELS.includes(rad.panel) ? rad.panel : "top";
    const { W, H, D } = this._dims();
    const t = m(model.thickness_mm);
    const len = m(model.length_mm);
    const wid = m(model.width_mm);
    const onPanel = activeLayouts(kase, build.patterns).filter((l) => l.panel === panel);
    const radMounts = (build.mounts || []).filter((mt) => mt.state === "radiator" && onPanel.some((l) => l.id === mt.id));
    const layouts = (radMounts.length ? radMounts.map((mt) => onPanel.find((l) => l.id === mt.id)) : onPanel).filter(Boolean);
    const mean = (key) => layouts.reduce((s, l) => s + m(l[key]), 0) / Math.max(layouts.length, 1);
    let size;
    let pos;
    let inward;
    const slideTo = (length, span) => {
      // Slide the slab to one end of its panel when the build says so.
      if (rad.offset === "rear") return span - 0.015 - length / 2;
      if (rad.offset === "front") return 0.015 + length / 2;
      return null;
    };
    const slab = radiatorModel(Math.min(len, (panel === "front" ? H : D) - 0.04), wid, t);
    if (panel === "top") {
      size = [Math.min(len, D - 0.04), t, wid];
      const x = slideTo(size[0], D) ?? (layouts.length ? mean("x_mm") : D / 2);
      pos = new THREE.Vector3(x, H - t / 2 - 0.004, layouts.length ? mean("z_mm") : W / 2);
      inward = new THREE.Vector3(0, -1, 0);
    } else if (panel === "front") {
      size = [t, Math.min(len, H - 0.04), wid];
      pos = new THREE.Vector3(t / 2 + 0.004, layouts.length ? mean("y_mm") : H / 2, layouts.length ? mean("z_mm") : W / 2);
      inward = new THREE.Vector3(1, 0, 0);
      slab.rotation.z = Math.PI / 2;
    } else {
      size = [Math.min(len, D - 0.04), t, wid];
      const x = slideTo(size[0], D) ?? (layouts.length ? mean("x_mm") : D / 2);
      pos = new THREE.Vector3(x, t / 2 + 0.004, layouts.length ? mean("z_mm") : W / 2);
      inward = new THREE.Vector3(0, 1, 0);
    }
    slab.position.copy(pos);
    const ud = { kind: "radiator", tip: `Radiator: ${model.name}, ${rad.direction}, fans on its inner face` };
    this._add(slab, ud);
    // Fans sit directly on the radiator's inner face.
    const count = rad.fan_count || model.fan_count || 3;
    const fan = presets.fans.find((f) => f.id === (rad.fan || model.default_fan));
    const fanSize = m(fan ? fan.size_mm : model.fan_size_mm);
    const along = panel === "front" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const span = panel === "front" ? size[1] : size[0];
    const faceOffset = (panel === "front" ? size[0] : size[1]) / 2 + 0.0125;
    const outward = inward.clone().negate();
    for (let i = 0; i < count; i += 1) {
      const u = (i + 0.5) / count - 0.5;
      const c = pos.clone().addScaledVector(along, u * span).addScaledVector(inward, faceOffset);
      this._caseFan(c, outward, fanSize * 0.98, rad.direction === "intake" ? "intake" : "exhaust", fan, {
        kind: "radiator",
        tip: `Radiator fan: ${fan ? fan.name : "fan"}, ${rad.direction}`,
      });
    }
    // Hoses from the pump to the end tank nearest the socket.
    if (this.socket && (build.cpu?.cooling || "water") === "water") {
      const ends = [-1, 1].map((sgn) => pos.clone().addScaledVector(along, sgn * (span / 2 - 0.012)));
      const tank = ends.sort((a, b) => a.distanceTo(this.socket) - b.distanceTo(this.socket))[0];
      [-0.012, 0.012].forEach((dz) => {
        const pump = this.socket.clone().add(new THREE.Vector3(dz, 0, 0.05));
        const end = tank.clone().add(new THREE.Vector3(0, 0, dz)).addScaledVector(inward, size[panel === "front" ? 0 : 1] / 2);
        const pts = [
          pump,
          pump.clone().add(new THREE.Vector3(0, 0, 0.05)),
          end.clone().addScaledVector(inward, 0.07).add(new THREE.Vector3(0, 0, 0.02)),
          end,
        ];
        this._add(tube(pts), { kind: "part", tip: "AIO hoses, pump to radiator" });
      });
    }
  }

  cardBox(gpu, card) {
    const kase = this.ctx.kase;
    const { W } = this._dims();
    const L = m(card?.length_mm || 267);
    const T = m(card?.thickness_mm || 37);
    const Hc = m(card?.height_mm || 111);
    const slot = String(gpu.slot);
    if (slot.toLowerCase().startsWith("v")) {
      const index = kase.vertical_positions.findIndex((p) => p.id === slot);
      if (index < 0) return null;
      // Vertical brackets sit side by side at the rear, next to the glass:
      // v1 nearest the glass, one slot pitch apart. The card stands on edge
      // beside the middle of the horizontal stack.
      const z = W - 0.012 - T / 2 - index * m(kase.slot_pitch_mm);
      const y = this.slotY(Math.min(4, kase.horizontal_slots)) - Hc / 2 + 0.03;
      return {
        vertical: true,
        center: new THREE.Vector3(this._bracketX() - L / 2, y, z),
        size: [L, Hc, T],
        fanNormal: new THREE.Vector3(0, 0, 1),
        exhaustNormal: new THREE.Vector3(0, 0, -1),
      };
    }
    const s = Number(slot);
    // The card's PCB sits at the slot; the cooler hangs below it (fan face down).
    const ySlot = this.slotY(s) + 0.008;
    return {
      vertical: false,
      center: new THREE.Vector3(this._bracketX() - L / 2, ySlot - T / 2, 0.02 + Hc / 2),
      size: [L, T, Hc],
      fanNormal: new THREE.Vector3(0, -1, 0),
      exhaustNormal: new THREE.Vector3(0, 1, 0),
    };
  }

  _gpus() {
    const { build, solution, presets, fmt, tempColor } = this.ctx;
    const cards = Object.fromEntries((solution?.cards || []).map((c) => [c.id, c]));
    const plumeByLower = Object.fromEntries((solution?.plume || []).map((p) => [p.lower, p]));
    (build.gpus || []).forEach((gpu) => {
      const card = presets.cards.find((c) => c.id === gpu.card);
      const box = this.cardBox(gpu, card);
      if (!box) return;
      const res = cards[gpu.id];
      const through = card?.cooler === "flow_through";
      const L = box.size[0];
      const T = box.vertical ? box.size[2] : box.size[1];
      const Hc = box.vertical ? box.size[1] : box.size[2];
      const faces = card?.inlet_faces;
      const topInletShare = !through && (faces === "both" || faces === "cpu") ? (faces === "cpu" ? 0.5 : Math.max(0.1, 1 - (card.inlet_split ?? 0.75))) : 0;
      const model = gpuModel(card, { L, T, H: Hc, tempColor: tempColor(res ? res.t_die_c : 60), topInletShare });
      // Local card frame: X length, Y thickness (fan face −Y), Z height (gold
      // fingers −Z). A vertical card stands on edge with its fans toward the glass.
      if (box.vertical) model.rotation.x = -Math.PI / 2;
      model.position.copy(box.center);
      const order = this.ctx.order?.[gpu.id];
      const where = box.vertical ? `vertical ${gpu.slot}` : `slot ${gpu.slot}`;
      const tip =
        `GPU ${order ?? ""} · ${card ? card.name : gpu.card} · ${where}` +
        (res ? ` · ${fmt(res.t_die_c)}${res.throttle ? " (throttling)" : ""} · ${res.flow_cfm.toFixed(0)} CFM` : "") +
        (topInletShare && faces === "both" ? ` · breathes ${Math.round(topInletShare * 100)} % through the backplate side` : "");
      this._add(model, { kind: "gpu", id: gpu.id, tip });
      // Flow-through exhaust: a faint warm haze above the card, stronger when
      // the card above breathes it.
      if (through) {
        const plume = plumeByLower[gpu.id];
        const share = plume ? plume.share_of_upper_intake : 0.15;
        const h = 0.045;
        const haze = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.06, h, 24, 1, true),
          new THREE.MeshBasicMaterial({ color: CUE.exhaust, transparent: true, opacity: 0.06 + 0.22 * share, side: THREE.DoubleSide, depthWrite: false }),
        );
        haze.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), box.exhaustNormal);
        haze.position.copy(box.center).add(new THREE.Vector3(L / 2 - 0.09, 0, 0)).addScaledVector(box.exhaustNormal, T / 2 + h / 2);
        haze.userData = { kind: "part", tip: `${gpu.id} exhaust plume${plume ? `: ${Math.round(share * 100)} % of the next card's intake` : ""}` };
        this.root.add(haze);
      }
    });
  }

  _shroud() {
    const { build, kase, presets } = this.ctx;
    const mode = build.shroud?.mode || "off";
    if (mode === "off") return;
    const { W, D } = this._dims();
    const top = this.slotY(1) + 0.03;
    const bottom = this.slotY(kase.horizontal_slots) - m(kase.slot_pitch_mm);
    const count = mode === "on" ? Math.max(0, build.shroud.count || 0) : 0;
    const fan = presets.fans.find((f) => f.id === build.shroud.fan);
    const fanD = m(fan ? fan.size_mm : 140);
    // One plenum over every bracket, horizontal and vertical: it spans the full
    // case width (and overhangs if the fans side by side need more room) and
    // the full height of the slot area.
    const h = Math.max(top - bottom, fanD + 0.02);
    const wid = Math.max(W - 0.01, count * fanD + 0.02);
    const depth = 0.07;
    const g = new THREE.Group();
    const wall = 0.002;
    const plate = (sx, sy, sz, x, y, z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), MAT.black);
      p.position.set(x, y, z);
      g.add(p);
    };
    const cy = (top + bottom) / 2;
    const cx = D + depth / 2;
    plate(depth, wall, wid, cx, cy + h / 2, W / 2);
    plate(depth, wall, wid, cx, cy - h / 2, W / 2);
    plate(depth, h, wall, cx, cy, W / 2 - wid / 2);
    plate(depth, h, wall, cx, cy, W / 2 + wid / 2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(wall, h, wid), count ? MAT.smoke : MAT.black);
    back.position.set(D + depth, cy, W / 2);
    g.add(back);
    this._add(g, {
      kind: "part",
      tip: mode === "on" ? `Rear GPU shroud: one plenum over every bracket outlet, ${count} fans side by side pulling on it` : "Passive rear duct over the bracket outlets",
    });
    for (let i = 0; i < count; i += 1) {
      const z = W / 2 + (i - (count - 1) / 2) * (fanD + 0.004);
      this._caseFan(new THREE.Vector3(D + depth - 0.0145, cy, z), new THREE.Vector3(1, 0, 0), fanD * 0.98, "exhaust", fan, {
        kind: "shroud",
        tip: `Rear shroud fan: ${fan ? fan.name : "fan"}`,
      });
    }
  }

  /* ------------------------------------------------------------ camera, labels */

  _resize(force = false) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // A hidden tab reports 0×0 (or the canvas default). Do not frame that.
    if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const aspect = w / h;
    const sizeChanged = size.x !== w || size.y !== h;
    const aspectChanged = Math.abs(this.camera.aspect - aspect) > 1e-3;
    if (!force && !sizeChanged && !aspectChanged) return;
    this.renderer.setSize(w, h, false);
    this._frame();
  }

  _frame() {
    const canvas = this.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this._dir();
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fit = Math.min(vfov, hfov);
    const dist = ((sphere.radius * 1.02) / Math.sin(fit / 2)) * this.zoom;
    this.camera.position.copy(sphere.center.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = Math.max(dist - sphere.radius * 2, 0.005);
    this.camera.far = dist + sphere.radius * 3;
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
  }

  project(v) {
    this.root.updateMatrixWorld(true);
    const p = v.clone().applyMatrix4(this.root.matrixWorld).project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z };
  }

  _label() {
    // Text overlays were removed in rev 4.1: stats live in the side panel and
    // details appear on hover.
  }

  _placeLabels() {
    const layer = this.labelsEl;
    if (!layer) return;
    if (layer.childElementCount !== this.labels.length || layer.dataset.sig !== this._sig()) {
      layer.innerHTML = "";
      this.labels.forEach((l) => {
        const div = document.createElement("div");
        div.className = l.cls;
        div.textContent = l.text;
        layer.appendChild(div);
      });
      layer.dataset.sig = this._sig();
    }
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    const placed = [];
    this.labels.forEach((l, i) => {
      const el = layer.children[i];
      const p = this.project(l.pos);
      if (p.z > 1 || p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      let x = p.x * w;
      let y = p.y * h;
      // Nudge down until it does not sit on a label already placed.
      const bw = el.offsetWidth || 120;
      const bh = el.offsetHeight || 18;
      x = Math.min(Math.max(x, bw / 2 + 4), w - bw / 2 - 4);
      for (let k = 0; k < 12; k += 1) {
        const hit = placed.find((b) => Math.abs(b.x - x) < (b.w + bw) / 2 && Math.abs(b.y - y) < (b.h + bh) / 2);
        if (!hit) break;
        y = hit.y + (hit.h + bh) / 2 + 2;
      }
      y = Math.min(Math.max(y, bh / 2 + 2), h - bh / 2 - 2);
      placed.push({ x, y, w: bw, h: bh });
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }

  _sig() {
    return this.labels.map((l) => l.cls + l.text).join("|");
  }

  /* ------------------------------------------------------------ picking */

  _pick(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hits = ray.intersectObjects(this.root.children, true);
    const hit = hits.find((h) => h.object.userData && (h.object.userData.kind === "fan" || h.object.userData.kind === "gpu"));
    return hit ? hit.object.userData : null;
  }

  _hover(ev) {
    if (this.drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects(this.root.children, true).find((h) => h.object.userData && h.object.userData.tip);
    this.cb.onHover?.(hit ? hit.object.userData.tip : null, ev);
  }

  _touchLike(ev) {
    return ev.pointerType === "touch" || ev.pointerType === "pen";
  }

  _capture(ev) {
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // synthetic events have no capturable pointer
    }
  }

  _cancelPointer() {
    this.orbit = null;
    this.drag = null;
    this.canvas.style.cursor = "";
  }

  _down(ev) {
    // Mouse hits on the inset or legend are not case drags. Touch/pen on the
    // whole view orbit, including a finger that lands on a GPU or fan.
    if (!this._touchLike(ev) && ev.target !== this.canvas) return;
    const data = this._pick(ev);
    if (this._touchLike(ev)) {
      this.drag = data ? { data, x: ev.clientX, y: ev.clientY, tap: true } : null;
      this.orbit = { x: ev.clientX, y: ev.clientY, az: this.az, el: this.el, tap: true };
      this._capture(ev);
      this.canvas.style.cursor = "grabbing";
      return;
    }
    this.drag = data ? { data, x: ev.clientX, y: ev.clientY } : null;
    if (!data) {
      this.orbit = { x: ev.clientX, y: ev.clientY, az: this.az, el: this.el };
      this._capture(ev);
      this.canvas.style.cursor = "grabbing";
    }
  }

  _orbitMove(ev) {
    const o = this.orbit;
    const dx = ev.clientX - o.x;
    const dy = ev.clientY - o.y;
    if (o.tap && Math.hypot(dx, dy) <= 6) return;
    this.az = o.az - dx * 0.008;
    this.el = Math.max(-1.3, Math.min(1.3, o.el + dy * 0.006));
    this._frame();
  }

  _up(ev) {
    if (this.orbit) {
      const drag = this.drag;
      const moved = Math.hypot(ev.clientX - this.orbit.x, ev.clientY - this.orbit.y) > 6;
      this.orbit = null;
      this.drag = null;
      this.canvas.style.cursor = "";
      if (!moved && drag?.tap && drag.data && this.ctx) {
        if (drag.data.kind === "fan") this.cb.onPickMount?.(drag.data.id, drag.data.panel);
        if (drag.data.kind === "gpu") this.cb.onPickGpu?.(drag.data.id);
      }
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag || !this.ctx) return;
    const moved = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6;
    if (!moved) {
      if (drag.data.kind === "fan") this.cb.onPickMount?.(drag.data.id, drag.data.panel);
      if (drag.data.kind === "gpu") this.cb.onPickGpu?.(drag.data.id);
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const nx = (ev.clientX - rect.left) / rect.width;
    const ny = (ev.clientY - rect.top) / rect.height;
    if (drag.data.kind === "fan") {
      let best = null;
      let bestD = 1e9;
      activeLayouts(this.ctx.kase, this.ctx.build.patterns).forEach((layout) => {
        const p = this.project(this._face(layout.panel, layout).pos);
        const d = (p.x - nx) ** 2 + (p.y - ny) ** 2;
        if (d < bestD) {
          bestD = d;
          best = layout;
        }
      });
      if (best && bestD < 0.01 && best.id !== drag.data.id) this.cb.onMoveFan?.(drag.data.id, best.id);
    }
    if (drag.data.kind === "gpu") {
      const kase = this.ctx.kase;
      const gpu = this.ctx.build.gpus.find((g) => g.id === drag.data.id);
      const card = this.ctx.presets.cards.find((c) => c.id === gpu?.card);
      const slots = [];
      for (let s = 1; s <= kase.horizontal_slots; s += 1) slots.push(String(s));
      kase.vertical_positions.forEach((v) => slots.push(v.id));
      let best = null;
      let bestD = 1e9;
      slots.forEach((slot) => {
        const box = this.cardBox({ slot }, card);
        if (!box) return;
        const p = this.project(box.center);
        const d = (p.x - nx) ** 2 + (p.y - ny) ** 2;
        if (d < bestD) {
          bestD = d;
          best = slot;
        }
      });
      if (best && bestD < 0.02) this.cb.onMoveGpu?.(drag.data.id, best);
    }
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* Mounts that exist for the chosen fan pattern on each face (default: first). */
export function activeLayouts(kase, patterns = {}) {
  const options = {};
  kase.mounts.forEach((l) => {
    if (!l.pattern) return;
    (options[l.panel] ||= []);
    if (!options[l.panel].includes(l.pattern)) options[l.panel].push(l.pattern);
  });
  return kase.mounts.filter((l) => {
    if (!l.pattern) return true;
    const chosen = options[l.panel].includes(patterns?.[l.panel]) ? patterns[l.panel] : options[l.panel][0];
    return l.pattern === chosen;
  });
}

export function facePatterns(kase, panel) {
  const out = [];
  kase.mounts.forEach((l) => {
    if (l.panel === panel && l.pattern && !out.includes(l.pattern)) out.push(l.pattern);
  });
  return out;
}

/* "Front ×8 · all Corsair AF120 RGB ELITE · 65.6 CFM · intake" when every fan
 * on a face matches; otherwise a short breakdown. */
export function faceFanLabel(panel, mounts, presets) {
  const fans = mounts.filter((mt) => mt.state === "fan" && mt.fan);
  const title = panel[0].toUpperCase() + panel.slice(1);
  if (!fans.length) {
    const blanks = mounts.filter((mt) => mt.state !== "radiator").length;
    return blanks ? `${title}: ${blanks} cover plate${blanks > 1 ? "s" : ""}, no fans` : "";
  }
  const key = (mt) => `${mt.fan}|${mt.direction}|${Math.round((mt.duty ?? 1) * 100)}`;
  const groups = {};
  fans.forEach((mt) => (groups[key(mt)] ||= []).push(mt));
  const describe = (mt, all) => {
    const f = presets.fans.find((x) => x.id === mt.fan);
    const name = f ? f.name : mt.fan;
    const spec = f ? ` · ${f.airflow_cfm.toFixed(1)} CFM · ${f.static_pressure_mmh2o} mmH₂O` : "";
    const duty = (mt.duty ?? 1) < 0.999 ? ` · ${Math.round(mt.duty * 100)}%` : "";
    return `${all ? "all " : ""}${name}${spec}${duty} · ${mt.direction}`;
  };
  const entries = Object.values(groups);
  const others = mounts.length - fans.length - mounts.filter((mt) => mt.state === "radiator").length;
  const tail = others > 0 ? ` (+${others} plugged)` : "";
  if (entries.length === 1) {
    const head = fans.length > 1 ? `${title} fans ×${fans.length}` : `${title} fan`;
    return `${head}: ${describe(entries[0][0], fans.length > 1)}${tail}`;
  }
  return `${title}: ` + entries.map((g) => `${g.length}× ${describe(g[0], false)}`).join("; ") + tail;
}
