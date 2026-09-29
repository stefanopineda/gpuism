/* Public site: answer /api/* from the Pyodide worker. Loaded only by the gpuism.com build. */
window.GPUSIM_BROWSER = true;

const statusEl = document.createElement("p");
statusEl.id = "solver-status";
statusEl.className = "fine solver-status";
statusEl.textContent = "Loading the solver in this browser…";
document.querySelector(".start-card")?.append(statusEl);

const worker = new Worker(new URL("./browser-worker.js", import.meta.url));
let seq = 0;
const pending = new Map();

worker.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === "status" && statusEl) {
    statusEl.textContent = msg.text;
    return;
  }
  const wait = pending.get(msg.id);
  if (!wait) return;
  pending.delete(msg.id);
  if (msg.error) wait.reject(new Error(msg.error));
  else wait.resolve(msg.raw);
};

function callWorker(method, path, body) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, path, body });
  });
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let path = url;
  try {
    path = new URL(url, location.origin).pathname;
  } catch {
    /* keep the raw string */
  }
  if (!path.startsWith("/api/")) return nativeFetch(input, init);
  const method = (init && init.method) || "GET";
  const body = init && init.body != null ? String(init.body) : "";
  try {
    const raw = await callWorker(method, path, body);
    const parsed = JSON.parse(raw);
    return new Response(parsed.payload, {
      status: parsed.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (statusEl) statusEl.textContent = "The in-browser solver failed to load. Check the connection and reload.";
    return new Response(JSON.stringify({ detail: String(err.message || err) }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
};
