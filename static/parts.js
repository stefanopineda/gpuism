/* Realistic part models for the case view. Everything is procedural (no
 * downloaded meshes): PBR materials, canvas textures, and real part
 * proportions. Colour is used only as a cue — a lit ring on each fan for
 * intake / exhaust / internal, and a temperature light bar on each GPU. */
import * as THREE from "./vendor/three.module.js?v=1158c1e396-2ca979df";

const cache = new Map();
/* Shared geometries, materials and textures are built once and flagged so the
 * scene never disposes them when it rebuilds. */
const once = (key, make) => {
  if (!cache.has(key)) {
    const v = make();
    if (v && v.userData) v.userData.shared = true;
    cache.set(key, v);
  }
  return cache.get(key);
};

export const isShared = (x) => Boolean(x && x.userData && x.userData.shared);

/* ------------------------------------------------------------------ textures */

function canvasTexture(key, w, h, draw, repeat = [1, 1], color = true) {
  return once(`tex:${key}`, () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 4;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/* Hex-hole perforated steel: white = solid, black = hole (alpha map). */
export function perforation(repeatX, repeatY) {
  const rx = Math.max(1, Math.round(repeatX));
  const ry = Math.max(1, Math.round(repeatY));
  return canvasTexture(`perf:${rx}:${ry}`, 64, 64, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#000";
    const r = 9;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const x = col * 22 + (row % 2 ? 11 : 0);
        const y = row * 21 + 10;
        g.beginPath();
        for (let k = 0; k < 6; k += 1) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
        }
        g.closePath();
        g.fill();
      }
    }
  }, [rx, ry], false);
}

function pcbTexture() {
  return canvasTexture("pcb", 512, 512, (g, w, h) => {
    g.fillStyle = "#16181b";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(120,130,140,0.22)";
    g.lineWidth = 1.2;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i += 1) {
      let x = rnd() * w;
      let y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k += 1) {
        if (rnd() > 0.5) x += (rnd() - 0.5) * 120;
        else y += (rnd() - 0.5) * 120;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(200,190,160,0.5)";
    for (let i = 0; i < 400; i += 1) g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 1.5 + rnd() * 3);
  });
}

function finTexture(dense = 3, dark = false) {
  return canvasTexture(`fins${dense}${dark ? "d" : ""}`, 256, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, dark ? "#3a3d42" : "#d6dade");
    grad.addColorStop(1, dark ? "#1d1f22" : "#9aa0a6");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = dark ? "#0a0b0c" : "#5d646b";
    g.lineWidth = 1;
    for (let x = 0.5; x < w; x += dense) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  }, [2, 1]);
}

function ventTexture() {
  return canvasTexture("vent", 128, 256, (g, w, h) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#000";
    for (let y = 14; y < h - 10; y += 16) g.fillRect(18, y, w - 36, 8);
  }, [1, 1], false);
}

function honeycomb() {
  return perforation(7, 7);
}

/* ------------------------------------------------------------------ materials */

export const MAT = {
  get steel() { return once("m:steel", () => new THREE.MeshStandardMaterial({ color: 0x19191c, metalness: 0.2, roughness: 0.58 })); },
  get steelMid() { return once("m:steelMid", () => new THREE.MeshStandardMaterial({ color: 0x2a2b2f, metalness: 0.35, roughness: 0.5 })); },
  get alu() { return once("m:alu", () => new THREE.MeshStandardMaterial({ color: 0xc3c7cc, metalness: 0.95, roughness: 0.3 })); },
  get aluDark() { return once("m:aluDark", () => new THREE.MeshStandardMaterial({ color: 0x3b3e43, metalness: 0.75, roughness: 0.36 })); },
  get black() { return once("m:black", () => new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.15, roughness: 0.6 })); },
  get blade() { return once("m:blade", () => new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.05, roughness: 0.45, side: THREE.DoubleSide })); },
  get noctua() { return once("m:noctua", () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide })); },
  get beige() { return once("m:beige", () => new THREE.MeshStandardMaterial({ color: 0xd9c7a8, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide })); },
  get brown() { return once("m:brown", () => new THREE.MeshStandardMaterial({ color: 0x6b3f2a, metalness: 0.05, roughness: 0.5, side: THREE.DoubleSide })); },
  get gpuBody() { return once("m:gpuBody", () => new THREE.MeshStandardMaterial({ color: 0x1f2023, metalness: 0.55, roughness: 0.34 })); },
  get darkFins() { return once("m:darkFins", () => new THREE.MeshStandardMaterial({ map: finTexture(3, true), metalness: 0.4, roughness: 0.55 })); },
  get gold() { return once("m:gold", () => new THREE.MeshStandardMaterial({ color: 0xd8a948, metalness: 1, roughness: 0.28 })); },
  get copper() { return once("m:copper", () => new THREE.MeshStandardMaterial({ color: 0xc27a45, metalness: 1, roughness: 0.3 })); },
  get nickel() { return once("m:nickel", () => new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.18 })); },
  get rubber() { return once("m:rubber", () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85 })); },
  get pcb() { return once("m:pcb", () => new THREE.MeshStandardMaterial({ map: pcbTexture(), metalness: 0.2, roughness: 0.55 })); },
  get fins() { return once("m:fins", () => new THREE.MeshStandardMaterial({ map: finTexture(3), metalness: 0.85, roughness: 0.38 })); },
  get glass() {
    return once("m:glass", () => new THREE.MeshPhysicalMaterial({
      color: 0xaebfcc, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0.02,
      envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false,
    }));
  },
  get smoke() {
    return once("m:smoke", () => new THREE.MeshPhysicalMaterial({
      color: 0x1b1c20, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.45, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    }));
  },
};

/* Perforated steel. Rendered as a see-through alpha map rather than an alpha
 * test so that, from a distance, it reads as dark mesh instead of shimmering. */
export function meshPanelMaterial(widthM, heightM, opacity = 0.9) {
  const pitch = 0.018; // one 64-px tile ≈ three 6 mm holes
  return new THREE.MeshStandardMaterial({
    color: 0x141518, metalness: 0.3, roughness: 0.5, alphaMap: perforation(widthM / pitch, heightM / pitch),
    transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
}

/* Lit accent (fan ring, GPU light bar). */
export function glow(color, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4 });
}

export const CUE = { intake: 0x2f86ff, exhaust: 0xff4a3a, internal: 0xffa640 };

/* ------------------------------------------------------------------ helpers */

function box(w, h, d, material) {
  return new THREE.Mesh(once(`g:box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), material);
}

function cyl(r, h, material, segs = 32) {
  return new THREE.Mesh(once(`g:cyl:${r}:${h}:${segs}`, () => new THREE.CylinderGeometry(r, r, h, segs)), material);
}

export function tag(object, userData) {
  object.traverse((o) => {
    o.userData = userData;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return object;
}

/* Rotate a part built along +Z so that +Z points along `normal`. */
export function orient(object, normal) {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  return object;
}

/* ------------------------------------------------------------------ fans */

function bladeGeometry(r, count) {
  return once(`g:blades:${r}:${count}`, () => {
    const hub = r * 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(hub, -r * 0.08);
    shape.quadraticCurveTo(r * 0.7, -r * 0.22, r * 0.94, -r * 0.05);
    shape.quadraticCurveTo(r * 0.98, r * 0.18, r * 0.7, r * 0.3);
    shape.quadraticCurveTo(r * 0.45, r * 0.24, hub, r * 0.1);
    shape.closePath();
    const one = new THREE.ExtrudeGeometry(shape, { depth: 0.0015, bevelEnabled: false });
    one.rotateX(0.35); // blade pitch
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const g = one.clone();
      g.rotateZ((2 * Math.PI * i) / count);
      parts.push(g);
    }
    return mergeGeometries(parts);
  });
}

function frameGeometry(size, depth) {
  return once(`g:frame:${size}:${depth}`, () => {
    const h = size / 2;
    const c = size * 0.08;
    const s = new THREE.Shape();
    s.moveTo(-h + c, -h);
    s.lineTo(h - c, -h);
    s.quadraticCurveTo(h, -h, h, -h + c);
    s.lineTo(h, h - c);
    s.quadraticCurveTo(h, h, h - c, h);
    s.lineTo(-h + c, h);
    s.quadraticCurveTo(-h, h, -h, h - c);
    s.lineTo(-h, -h + c);
    s.quadraticCurveTo(-h, -h, -h + c, -h);
    const hole = new THREE.Path();
    hole.absarc(0, 0, h * 0.965, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: 40 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/* A case fan: square frame, blades, hub, and a thin lit ring whose colour says
 * intake / exhaust / internal. Axis is +Z, airflow along `flow` (+1 or −1). */
export function fanModel(sizeM, { cue = null, style = "black", depth = 0.025, blades = 9, frame: square = true } = {}) {
  const g = new THREE.Group();
  const r = (sizeM / 2) * 0.93;
  const frameMat = style === "classic" ? MAT.beige : style === "grey" ? MAT.noctua : MAT.black;
  const bladeMat = style === "classic" ? MAT.brown : style === "grey" ? MAT.noctua : MAT.blade;
  // Case fans have a square frame; a GPU's own fans sit in a round opening.
  g.add(
    square
      ? new THREE.Mesh(frameGeometry(sizeM, depth), frameMat)
      : new THREE.Mesh(once(`g:gpuFanRim:${sizeM}`, () => new THREE.TorusGeometry((sizeM / 2) * 0.97, 0.0018, 8, 64)), MAT.black),
  );
  const rotor = new THREE.Mesh(bladeGeometry(r, blades), bladeMat);
  g.add(rotor);
  const hub = cyl(r * 0.3, depth * 0.8, MAT.black, 28);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  const cap = cyl(r * 0.2, depth * 0.82, MAT.steelMid, 24);
  cap.rotation.x = Math.PI / 2;
  g.add(cap);
  // Struts on the motor side (case fans only).
  for (let i = 0; i < (square ? 4 : 0); i += 1) {
    const s = box(r * 1.05, 0.003, 0.003, MAT.black);
    s.position.z = -depth / 2 + 0.002;
    s.rotation.z = (Math.PI / 4) * (2 * i + 1) * 0.5;
    g.add(s);
  }
  if (cue) {
    // A thin lit ring on both faces: the only colour on an otherwise real fan.
    const mat = glow(cue, 1.2);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(once(`g:ring:${sizeM}`, () => new THREE.TorusGeometry((sizeM / 2) * 0.975, 0.0018, 8, 64)), mat);
      ring.position.z = side * (depth / 2 + 0.0006);
      g.add(ring);
    }
  }
  return g;
}

/* Steel blanking plate over an unused mount. */
export function coverPlate(sizeM) {
  const g = new THREE.Group();
  g.add(box(sizeM * 0.98, sizeM * 0.98, 0.0015, MAT.steelMid));
  return g;
}

/* An open, unfilled mount: just the dark rim of the hole. */
export function openHole(sizeM) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(once(`g:hole:${sizeM}`, () => new THREE.TorusGeometry((sizeM / 2) * 0.95, 0.0022, 8, 48)), MAT.aluDark));
  return g;
}

/* ------------------------------------------------------------------ GPUs */

/* Modelled on NVIDIA's product photos (nvidia.com RTX PRO 6000 Blackwell
 * Max-Q and Workstation Edition pages, and the Workstation datasheet):
 *   Max-Q: glossy black box shroud, one blower with a polished hub and a
 *     champagne ring, a full-length window of gold fins along the top edge,
 *     gold NVIDIA mark and "RTX PRO 6000" on that edge.
 *   Workstation (600 W): rounded matte-black double flow-through body, an X
 *     ("bow-tie") face with finely grooved fin zones at both ends and a gloss
 *     centre marked "RTX PRO 6000" in gold, two fans on the underside, gold
 *     NVIDIA mark and a recessed 12V-2x6 connector on the top edge.
 * The RTX 5090 FE uses the same body in gunmetal; the 3090 FE keeps its
 * second fan on the backplate side. */

const GOLD_TEXT = "#c9a860";

function textTexture(key, text, { w = 512, h = 96, size = 64, weight = 600, eye = false, align = "center", spacing = 0 } = {}) {
  return canvasTexture(`txt:${key}`, w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = GOLD_TEXT;
    g.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
    g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = `${spacing}px`;
    let x = align === "center" ? w / 2 : 8;
    g.textAlign = align === "center" ? "center" : "left";
    if (eye) {
      // The NVIDIA "eye": a rounded mark with a swirl cut through it.
      const s = h * 0.62;
      const ex = 8;
      const ey = (h - s) / 2;
      g.fillRect(ex, ey, s, s);
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = s * 0.14;
      g.beginPath();
      g.ellipse(ex + s * 0.62, ey + s * 0.5, s * 0.34, s * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(ex + s * 0.62, ey + s * 0.5, s * 0.08, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      x = ex + s + 16;
      g.textAlign = "left";
    }
    g.fillText(text, x, h / 2 + 2);
  }, [1, 1]);
}

function decal(tex, w, h) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, metalness: 0.85, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  // The scene root is mirrored in x (front on the right), so pre-mirror text
  // along the card's length to read the right way round.
  mesh.scale.x = -1;
  return mesh;
}

/* Fine grooves, the texture of a fin stack seen through a vented face. */
function grooveTexture(key, pitch, base, line, repeat = [1, 1]) {
  return canvasTexture(`groove:${key}`, 256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = line;
    g.lineWidth = pitch * 0.45;
    for (let y = pitch / 2; y < h; y += pitch) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }, repeat);
}

/* Gold fin window of the Max-Q: vertical fins, bronze, darker toward the ends. */
function goldFinTexture() {
  return canvasTexture("goldfins", 1024, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#3b3122");
    grad.addColorStop(0.2, "#9c8659");
    grad.addColorStop(0.5, "#c7ae78");
    grad.addColorStop(0.8, "#8f7a51");
    grad.addColorStop(1, "#3b3122");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(10,8,5,0.75)";
    for (let x = 0; x < w; x += 5) g.fillRect(x, 0, 2, h);
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,0.55)");
    shade.addColorStop(0.35, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
  }, [1, 1]);
}

const GPU_MAT = {
  get gloss() {
    return once("m:gpuGloss", () => new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.45 }));
  },
  get matte() { return once("m:gpuMatte", () => new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.5 })); },
  get gunmetal() { return once("m:gpuGun", () => new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.3 })); },
  get groove() {
    // Shape UVs are in metres: 18 tiles of 64 grooves per metre ≈ 0.9 mm pitch.
    return once("m:gpuGroove", () => new THREE.MeshStandardMaterial({ map: grooveTexture("dark", 4, "#060607", "#303134", [1, 18]), metalness: 0.45, roughness: 0.5, envMapIntensity: 0.55 }));
  },
  get goldFins() { return once("m:goldFins", () => new THREE.MeshStandardMaterial({ map: goldFinTexture(), metalness: 0.9, roughness: 0.32 })); },
  get champagne() { return once("m:champagne", () => new THREE.MeshStandardMaterial({ color: 0xc9b07a, metalness: 1, roughness: 0.25 })); },
  get hub() { return once("m:hub", () => new THREE.MeshStandardMaterial({ color: 0xd4d7da, metalness: 1, roughness: 0.12 })); },
  get bracket() {
    return once("m:bracket", () => new THREE.MeshStandardMaterial({ color: 0xc0c3c7, metalness: 0.95, roughness: 0.3, alphaMap: ventTexture(), alphaTest: 0.5 }));
  },
};

/* Blower impeller seen through the fan eye: dark blades round a polished hub. */
function blowerWheel(r, { hub = true } = {}) {
  const g = new THREE.Group();
  const well = cyl(r, 0.002, MAT.black, 40);
  well.rotation.x = Math.PI / 2;
  g.add(well);
  const blades = once(`g:impeller:${r}`, () => {
    const parts = [];
    for (let i = 0; i < 44; i += 1) {
      const b = new THREE.BoxGeometry(r * 0.36, 0.0009, 0.004);
      b.translate(r * 0.8, 0, 0.002);
      b.rotateZ((2 * Math.PI * i) / 44 + 0.35);
      parts.push(b);
    }
    return mergeGeometries(parts);
  });
  g.add(new THREE.Mesh(blades, MAT.blade));
  if (hub) {
    // Polished, slightly domed hub cap.
    const cap = new THREE.Mesh(once(`g:hubcap:${r}`, () => new THREE.SphereGeometry(r * 0.58, 40, 12, 0, Math.PI * 2, 0, 0.42)), GPU_MAT.hub);
    cap.rotation.x = Math.PI / 2;
    cap.scale.set(1, 0.35, 1);
    cap.position.z = 0.001 - r * 0.58 * Math.cos(0.42) * 0.35; // seat the cap on the face
    g.add(cap);
  }
  return g;
}

/* Parts every card shares: PCIe fingers into the slot and the I/O bracket. */
function cardCommon(g, L, T, H) {
  const fingers = box(0.089, 0.0014, 0.008, MAT.gold);
  fingers.position.set(L / 2 - 0.0885, T / 2 - 0.006, -H / 2 - 0.004);
  g.add(fingers);
  const bracket = new THREE.Mesh(once("g:bracket", () => new THREE.BoxGeometry(0.0012, 1, 1)), GPU_MAT.bracket);
  bracket.scale.set(1, T + 0.004, H + 0.012);
  bracket.position.set(L / 2 + 0.0006, 0, 0.004);
  g.add(bracket);
}

/* Temperature cue: a thin lit line along the glass-facing edge. */
function tempLine(g, color, length, x, y, z) {
  const bar = box(length, 0.0016, 0.0012, glow(color, 1.8));
  bar.position.set(x, y, z);
  g.add(bar);
}

function maxqModel(card, { L, T, H, color, topInletShare, pro }) {
  const g = new THREE.Group();
  const body = box(L, T, H, GPU_MAT.gloss);
  g.add(body);
  // Blower eye on the fan face (−Y, toward the floor).
  const r = Math.min(0.043, H * 0.39);
  const fx = -L / 2 + 0.062;
  const wheel = blowerWheel(r);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(fx, -T / 2 - 0.0004, 0);
  g.add(wheel);
  const ring = new THREE.Mesh(once(`g:eyeRing:${r}`, () => new THREE.TorusGeometry(r + 0.0015, 0.0016, 10, 64)), GPU_MAT.champagne);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(fx, -T / 2 - 0.0006, 0);
  g.add(ring);
  if (topInletShare > 0) {
    // Part of the eye is also open through the backplate side (Max-Q).
    const rr = Math.min(0.032, r * Math.sqrt(topInletShare / Math.max(1 - topInletShare, 0.1)));
    const eye = blowerWheel(rr, { hub: false });
    eye.rotation.x = -Math.PI / 2;
    eye.position.set(fx, T / 2 + 0.0004, 0);
    g.add(eye);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.001, 0.0012, 8, 48), GPU_MAT.champagne);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(fx, T / 2 + 0.0006, 0);
    g.add(rim);
  }
  // Glass-facing edge (+Z): long gold fin window toward the fan face, gold
  // marks on the strip beside it.
  const winLen = L - 0.05;
  const winH = T * 0.56;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(winLen, winH), GPU_MAT.goldFins);
  win.position.set(-0.008, -T / 2 + 0.004 + winH / 2, H / 2 + 0.0004);
  g.add(win);
  const frame = box(winLen + 0.003, winH + 0.003, 0.0006, GPU_MAT.matte);
  frame.position.set(-0.008, win.position.y, H / 2 + 0.0001);
  g.add(frame);
  const stripY = (win.position.y + winH / 2 + T / 2) / 2;
  if (pro) {
    const logo = decal(textTexture("nvidia", "NVIDIA", { eye: true, size: 58, weight: 700, align: "left", spacing: 2 }), 0.05, 0.0094);
    logo.position.set(-L / 2 + 0.035, stripY, H / 2 + 0.0006);
    g.add(logo);
    const name = decal(textTexture("rtxpro", "RTX PRO 6000", { size: 50, weight: 500, spacing: 3 }), 0.034, 0.0064);
    name.position.set(L / 2 - 0.03, stripY, H / 2 + 0.0006);
    g.add(name);
  }
  tempLine(g, color, winLen * 0.55, 0, T / 2 - 0.0025, H / 2 + 0.0006);
  cardCommon(g, L, T, H);
  return g;
}

/* Rounded-rectangle outline in the card's length × height plane. */
function roundedOutline(L, H, r) {
  const s = new THREE.Shape();
  const x0 = -L / 2;
  const y0 = -H / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + L - r, y0);
  s.quadraticCurveTo(x0 + L, y0, x0 + L, y0 + r);
  s.lineTo(x0 + L, y0 + H - r);
  s.quadraticCurveTo(x0 + L, y0 + H, x0 + L - r, y0 + H);
  s.lineTo(x0 + r, y0 + H);
  s.quadraticCurveTo(x0, y0 + H, x0, y0 + H - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/* One end zone of the X face: a hexagon whose inner edge points at the centre. */
function endZone(L, H, side, { edge = 0.009, centre = 0.014, slant = 0.042 } = {}) {
  const s = new THREE.Shape();
  const outer = side * (L / 2 - edge);
  const innerTip = side * centre;
  const innerCorner = side * (centre + slant);
  const top = H / 2 - edge;
  s.moveTo(outer, -top);
  s.lineTo(innerCorner, -top);
  s.lineTo(innerTip, 0);
  s.lineTo(innerCorner, top);
  s.lineTo(outer, top);
  s.closePath();
  return s;
}

/* Lay a shape drawn in (length, height) onto a card face: +1 = backplate
 * (+Y), −1 = fan face (−Y). */
function onFace(geo, face, y) {
  geo.rotateX(face > 0 ? -Math.PI / 2 : Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

function flowThroughModel(card, { L, T, H, color }) {
  const g = new THREE.Group();
  const id = card?.id || "";
  const pro = id.includes("rtx-pro-6000");
  const is3090 = id === "rtx-3090-fe";
  const bodyMat = pro ? GPU_MAT.matte : GPU_MAT.gunmetal;
  const bevel = 0.0025;
  const bodyGeo = new THREE.ExtrudeGeometry(roundedOutline(L - 2 * bevel, H - 2 * bevel, 0.016), {
    depth: T - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10,
  });
  bodyGeo.rotateX(Math.PI / 2); // extrusion along −Y, outline height along +Z
  bodyGeo.translate(0, (T - 2 * bevel) / 2, 0);
  g.add(new THREE.Mesh(bodyGeo, bodyMat));
  // Both broad faces carry the X: grooved fin zones at the ends, a darker
  // gloss centre between them.
  for (const face of [1, -1]) {
    const y = face * (T / 2 + 0.0004);
    for (const side of [-1, 1]) {
      const zone = new THREE.Mesh(onFace(new THREE.ShapeGeometry(endZone(L, H, side)), face, y), GPU_MAT.groove);
      g.add(zone);
    }
    const centre = new THREE.Shape();
    const c = 0.014 + 0.042 - 0.006;
    const top = H / 2 - 0.009;
    centre.moveTo(-c + 0.006, -top);
    centre.lineTo(c - 0.006, -top);
    centre.lineTo(0.008, 0);
    centre.lineTo(c - 0.006, top);
    centre.lineTo(-c + 0.006, top);
    centre.lineTo(-0.008, 0);
    centre.closePath();
    g.add(new THREE.Mesh(onFace(new THREE.ShapeGeometry(centre), face, face * (T / 2 + 0.0002)), GPU_MAT.gloss));
  }
  if (pro) {
    const name = decal(textTexture("rtxpro", "RTX PRO 6000", { size: 50, weight: 500, spacing: 3 }), 0.036, 0.0068);
    name.rotation.x = -Math.PI / 2;
    name.position.set(0, T / 2 + 0.0008, H * 0.2);
    g.add(name);
  }
  // Two fans on the underside, in the fin zones. The 3090 FE's second fan is
  // on the backplate side at the bracket end.
  const fanD = Math.min(0.1, H * 0.72);
  const fx = L / 2 - 0.009 - fanD / 2 - 0.004;
  [-fx, fx].forEach((x, i) => {
    const onBack = is3090 && i === 1;
    const fan = fanModel(fanD, { depth: 0.003, blades: 7, frame: false });
    fan.rotation.x = onBack ? -Math.PI / 2 : Math.PI / 2;
    fan.position.set(x, (onBack ? 1 : -1) * (T / 2 + 0.0019), 0);
    g.add(fan);
  });
  // Glass-facing edge (+Z): gold NVIDIA mark toward the front, recessed power
  // connector in the middle.
  const edgeZ = H / 2 + 0.0006;
  if (pro || id === "rtx-5090-fe") {
    const logo = decal(textTexture("nvidia", "NVIDIA", { eye: true, size: 58, weight: 700, align: "left", spacing: 2 }), 0.06, 0.0112);
    logo.position.set(-L / 2 + 0.05, 0, edgeZ);
    g.add(logo);
  }
  const pocket = box(0.034, T * 0.55, 0.004, MAT.black);
  pocket.position.set(0.01, 0, H / 2 - 0.0012);
  g.add(pocket);
  const plug = box(0.02, T * 0.28, 0.006, MAT.rubber);
  plug.position.set(0.01, 0, H / 2 + 0.001);
  g.add(plug);
  tempLine(g, color, L * 0.3, L * 0.26, T / 2 - 0.004, edgeZ);
  cardCommon(g, L, T, H);
  return g;
}

/* A graphics card in local coordinates: X = length (bracket at +X), Y =
 * thickness (fan face at −Y, backplate at +Y), Z = height (PCB edge and gold
 * fingers at −Z toward the board, top edge +Z toward the glass). */
export function gpuModel(card, { L, T, H, tempColor, topInletShare = 0 }) {
  const color = new THREE.Color(tempColor);
  if (card?.cooler === "flow_through") return flowThroughModel(card, { L, T, H, color });
  return maxqModel(card, { L, T, H, color, topInletShare, pro: (card?.id || "").includes("rtx-pro-6000") });
}

/* ------------------------------------------------------------------ board, CPU */

/* WRX90E-SAGE SE style board in case coordinates (metres): the PCB lies on
 * standoffs just off the tray, rear I/O at `rear`. */
export function motherboardModel({ depth, height, top, rear, slotYs }) {
  const g = new THREE.Group();
  const cx = rear - depth / 2;
  const cy = top - height / 2;
  const pcb = box(depth, height, 0.0016, MAT.pcb);
  pcb.position.set(cx, cy, 0.009);
  g.add(pcb);
  // Rear I/O shroud and VRM heatsinks along the top edge.
  const io = box(0.03, 0.14, 0.032, MAT.aluDark);
  io.position.set(rear - 0.02, top - 0.095, 0.026);
  g.add(io);
  const vrmTop = box(depth * 0.5, 0.024, 0.028, MAT.aluDark);
  vrmTop.position.set(rear - depth * 0.46, top - 0.02, 0.024);
  g.add(vrmTop);
  // Chipset and M.2 heatsinks in the lower board, clear of the PCIe slots.
  const chip = box(0.07, 0.07, 0.012, MAT.alu);
  chip.position.set(rear - depth + 0.06, top - height + 0.055, 0.016);
  g.add(chip);
  // 24-pin and EPS connectors on the front edge.
  const atx = box(0.012, 0.052, 0.014, MAT.black);
  atx.position.set(rear - depth + 0.008, top - 0.12, 0.017);
  g.add(atx);
  // PCIe x16 slots with steel armour.
  slotYs.forEach((y) => {
    const s = box(0.089, 0.0075, 0.011, MAT.black);
    s.position.set(rear - 0.0885, y, 0.0155);
    g.add(s);
    const armour = box(0.09, 0.0086, 0.002, MAT.nickel);
    armour.position.set(rear - 0.0885, y, 0.0215);
    g.add(armour);
  });
  return g;
}

/* sTR5 socket, eight DDR5 RDIMMs, and the cooler (tower or AIO pump). */
export function cpuAreaModel({ cooling, fans, upward, cue }) {
  const g = new THREE.Group();
  const ihs = box(0.072, 0.075, 0.006, MAT.nickel);
  ihs.position.z = 0.004;
  g.add(ihs);
  const frame = box(0.086, 0.09, 0.004, MAT.steelMid);
  frame.position.z = 0.002;
  g.add(frame);
  for (let k = 0; k < 4; k += 1) {
    for (const side of [-1, 1]) {
      const x = side * (0.06 + k * 0.0095);
      const slot = box(0.0062, 0.14, 0.006, MAT.black);
      slot.position.set(x, 0, 0.003);
      g.add(slot);
      const stick = box(0.0045, 0.133, 0.031, MAT.steelMid);
      stick.position.set(x, 0, 0.021);
      g.add(stick);
      const top = box(0.0046, 0.128, 0.003, MAT.alu);
      top.position.set(x, 0, 0.037);
      g.add(top);
    }
  }
  if (cooling === "air") {
    // NH-U14S TR5-SP6 class: fins 150 × 52 mm, 165 mm tall off the board.
    const finsX = 0.15;
    const finsY = 0.052;
    const tall = 0.165;
    const base = box(0.07, 0.07, 0.012, MAT.nickel);
    base.position.z = 0.013;
    g.add(base);
    const count = 58;
    const fin = new THREE.InstancedMesh(
      once("g:cpufin", () => new THREE.BoxGeometry(1, 1, 0.0004)),
      MAT.alu,
      count,
    );
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const z = 0.03 + (i / (count - 1)) * (tall - 0.035);
      mtx.compose(new THREE.Vector3(0, 0, z), new THREE.Quaternion(), upward ? new THREE.Vector3(finsX, finsY, 1) : new THREE.Vector3(finsY, finsX, 1));
      fin.setMatrixAt(i, mtx);
    }
    g.add(fin);
    for (let i = 0; i < 6; i += 1) {
      const pipe = cyl(0.003, tall - 0.01, MAT.nickel, 12);
      pipe.rotation.x = Math.PI / 2;
      const off = (i - 2.5) * 0.02;
      pipe.position.set(upward ? off : 0, upward ? 0 : off, tall / 2 + 0.01);
      g.add(pipe);
    }
    const cover = box(upward ? finsX : finsY, upward ? finsY : finsX, 0.004, MAT.alu);
    cover.position.z = tall + 0.004;
    g.add(cover);
    const fanAt = (sign) => {
      const f = fanModel(0.14, { cue, style: "classic", depth: 0.025 });
      // Fan axis along ±Y (up) or ±X (rear), air moving the same way.
      const dir = upward ? new THREE.Vector3(0, sign, 0) : new THREE.Vector3(sign, 0, 0);
      orient(f, dir);
      const off = finsY / 2 + 0.0125;
      f.position.copy(dir.clone().multiplyScalar(off)).add(new THREE.Vector3(0, 0, 0.012 + tall / 2));
      g.add(f);
    };
    if (fans !== "bottom") fanAt(1);
    if (fans !== "top") fanAt(-1);
  } else {
    const pump = cyl(0.036, 0.045, MAT.black, 40);
    pump.rotation.x = Math.PI / 2;
    pump.position.z = 0.03;
    g.add(pump);
    const cap = cyl(0.03, 0.002, MAT.alu, 40);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.053;
    g.add(cap);
  }
  return g;
}

export function radiatorModel(len, width, thick) {
  const g = new THREE.Group();
  const core = box(len - 0.04, thick, width, once("m:radfins", () => new THREE.MeshStandardMaterial({ map: finTexture(2, true), metalness: 0.3, roughness: 0.6 })));
  g.add(core);
  [-1, 1].forEach((s) => {
    const tank = box(0.02, thick + 0.004, width + 0.004, MAT.black);
    tank.position.x = s * (len / 2 - 0.01);
    g.add(tank);
  });
  return g;
}

export function tube(points, radius = 0.0065) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 12, false), MAT.rubber);
}

export function psuModel(fanUp) {
  const g = new THREE.Group();
  const shell = box(0.17, 0.086, 0.15, MAT.steel);
  g.add(shell);
  const grille = new THREE.Mesh(
    once("g:psugrille", () => new THREE.PlaneGeometry(0.13, 0.13)),
    new THREE.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.6, roughness: 0.4, alphaMap: honeycomb(), alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  grille.rotation.x = Math.PI / 2;
  grille.position.y = fanUp ? 0.0435 : -0.0435;
  g.add(grille);
  const fan = fanModel(0.12, { depth: 0.015 });
  fan.rotation.x = Math.PI / 2;
  fan.position.y = fanUp ? 0.033 : -0.033;
  g.add(fan);
  const label = box(0.1, 0.03, 0.0008, new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.3, roughness: 0.6 }));
  label.position.set(0, 0.0, 0.0755);
  g.add(label);
  return g;
}

/* ------------------------------------------------------------------ merge (subset of BufferGeometryUtils) */

function mergeGeometries(geos) {
  const out = new THREE.BufferGeometry();
  const attrs = ["position", "normal", "uv"];
  let total = 0;
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  nonIndexed.forEach((g) => (total += g.attributes.position.count));
  attrs.forEach((name) => {
    const size = nonIndexed[0].attributes[name]?.itemSize;
    if (!size) return;
    const arr = new Float32Array(total * size);
    let off = 0;
    nonIndexed.forEach((g) => {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  });
  return out;
}
