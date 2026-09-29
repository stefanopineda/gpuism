/* Pyodide worker. The page talks to it instead of a server. */
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");

let booting = null;

function boot() {
  if (booting) return booting;
  booting = (async () => {
    self.postMessage({ type: "status", text: "Loading the solver in this browser…" });
    const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/" });
    self.postMessage({ type: "status", text: "Loading NumPy and the model…" });
    await pyodide.loadPackage(["numpy", "pyyaml", "pydantic"]);
    const bundle = await fetch(new URL("../py-bundle.json?v=e6b8122216-c827829c", self.location.href));
    if (!bundle.ok) throw new Error(`model bundle HTTP ${bundle.status}`);
    pyodide.FS.writeFile("/py-bundle.json", new Uint8Array(await bundle.arrayBuffer()));
    self.postMessage({ type: "status", text: "Starting the model…" });
    pyodide.runPython(`
import json, os, sys
from pathlib import Path
bundle = json.loads(Path("/py-bundle.json").read_text())
root = Path("/pkg")
for rel, text in bundle["files"].items():
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
os.environ["GPUSIM_PRESETS"] = str(root / "presets")
sys.path.insert(0, str(root))
from gpusim.browser_api import dispatch
`);
    self.postMessage({ type: "status", text: "Solver is running in this browser. Nothing you build is uploaded." });
    return pyodide;
  })().catch((err) => {
    booting = null;
    throw err;
  });
  return booting;
}

let chain = Promise.resolve();

self.onmessage = (ev) => {
  const msg = ev.data || {};
  chain = chain.then(() => handle(msg)).catch(() => {});
};

async function handle(msg) {
  try {
    const pyodide = await boot();
    pyodide.globals.set("req_method", msg.method || "GET");
    pyodide.globals.set("req_path", msg.path || "/");
    pyodide.globals.set("req_body", msg.body || "");
    const raw = pyodide.runPython(
      "import json\nstatus, payload = dispatch(req_method, req_path, req_body)\njson.dumps({'status': status, 'payload': payload})",
    );
    self.postMessage({ type: "result", id: msg.id, raw });
  } catch (err) {
    self.postMessage({ type: "result", id: msg.id, error: String(err && err.message ? err.message : err) });
  }
}
