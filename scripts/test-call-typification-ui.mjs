// Local-only browser fixture: actual form + React + built CSS, synthetic data,
// mocked server actions. Never connects to Supabase, SIP or Google Calendar.
// Run after npm run build: node scripts/test-call-typification-ui.mjs
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const modules = new Map();
const mocks = {
  "next/navigation": `exports.useRouter = () => ({ push: url => window.location.assign(url), refresh() {} });`,
  "@/lib/agent-control": `exports.notifyAgentManagementClosed = () => {};`,
  "@/lib/intercall-break": `exports.readLegalIntercallBreakUntil = () => new URLSearchParams(location.search).has('pause') ? Date.now()+10000 : 0;`,
  "@/app/actions/calls": `
    async function save(payload) {
      const response = await fetch('/close' + location.search, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      return response.json();
    }
    exports.closeCall = save; exports.reviseCallManagement = save;
    exports.discardCallTechnicalError = async () => { throw new Error('Descarte fuera de esta prueba'); };
  `,
};

function add(id) {
  if (modules.has(id)) return id;
  modules.set(id, "");
  let source = mocks[id] ?? readFileSync(id, "utf8");
  if (/\.tsx?$/.test(id)) source = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_, name) => {
    let target;
    if (name in mocks) target = name;
    else if (name.startsWith("@/")) {
      const base = join(root, "src", name.slice(2));
      try { target = require.resolve(base + ".ts"); } catch { target = require.resolve(base + ".tsx"); }
    } else target = createRequire(id.startsWith("/") ? id : import.meta.url).resolve(name);
    return `__require(${JSON.stringify(add(target))})`;
  });
  modules.set(id, source.replaceAll("process.env.NODE_ENV", '"production"'));
  return id;
}

const react = add(require.resolve("react"));
const dom = add(require.resolve("react-dom/client"));
const form = add(join(root, "src/components/call-typification-form.tsx"));
const reasons = add(join(root, "src/lib/call-typification.ts"));
const bundle = `const modules = {${[...modules].map(([id, code]) => `${JSON.stringify(id)}:(module,exports,__require)=>{${code}\n}`).join(",")}};
const cache = {}; function __require(id) { if(cache[id]) return cache[id].exports; const m=cache[id]={exports:{}}; modules[id](m,m.exports,__require); return m.exports; }
const React=__require(${JSON.stringify(react)}), {createRoot}=__require(${JSON.stringify(dom)});
const {CallTypificationForm}=__require(${JSON.stringify(form)}), {CALL_REASONS}=__require(${JSON.stringify(reasons)});
const params=new URLSearchParams(location.search);
const catalog=CALL_REASONS.filter(r=>['NO CONTESTA','BUZON DE VOZ','TELEFONO FUERA DE SERVICIO','VOLVER A LLAMAR','NO CALIFICA'].includes(r.value));
catalog.push({...CALL_REASONS.find(r=>r.value==='REUNION AGENDADA'),value:'AGENDA REUNION',label:'Agenda reunión'});
createRoot(document.getElementById('app')).render(React.createElement(CallTypificationForm,{
  lead:{id:'fixture-lead',email:null,observacion_actual:null},
  call:{id:'fixture-call',status:null,outcome:null,reason:null,notes:null,next_action_at:null},
  reasonCatalog:params.has('empty')?[]:catalog,
  appointmentScheduleUrl:params.has('other')?null:location.origin+'/reserve', revision:params.has('revision')
}));`;

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? cssFiles(path) : path.endsWith(".css") ? [path] : [];
  });
}
const css = cssFiles(join(root, ".next/static")).map((path) => readFileSync(path, "utf8")).join("\n");
let lastSubmission = null;
let submissions = 0;
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); return; }
  if (url.pathname === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
  if (url.pathname === "/close" && request.method === "POST") {
    let body = ""; for await (const chunk of request) body += chunk;
    lastSubmission = JSON.parse(body); submissions++;
    response.setHeader("Content-Type", "application/json");
    setTimeout(() => response.end(JSON.stringify(url.searchParams.has("error")
      ? { ok: false, error: "Finaliza la llamada antes de cerrar la gestión." } : { ok: true })), 500);
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname === "/reserve") { response.end("<h2>Agenda de prueba: sin reservas reales</h2>"); return; }
  if (url.pathname.startsWith("/dashboard/leads")) {
    response.end(`<h1>Gestión cerrada (prueba local)</h1><p>Envíos: ${submissions}</p><pre>${escape(JSON.stringify(lastSubmission, null, 2))}</pre>`); return;
  }
  response.end(`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Prueba local · Cierre Abogado Legal</title></head><body style="font-family:system-ui"><main style="max-width:1100px;margin:24px auto;padding:16px"><h1 style="font-size:24px;font-weight:bold;margin-bottom:16px">Abogado Legal · prueba sin llamadas reales</h1><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
});
server.listen(0, "127.0.0.1", () => console.log(`Fixture: http://127.0.0.1:${server.address().port}`));
