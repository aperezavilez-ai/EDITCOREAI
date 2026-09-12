"use strict";
const fs = require("fs");
const path = "C:/Users/apere/.cursor/projects/d-PROGRAMAS-IA-EDITCORE-AI/agent-transcripts/3a05f93b-0592-40cb-b7e0-2c78e8c16079/3a05f93b-0592-40cb-b7e0-2c78e8c16079.jsonl";
const claimRe = /(ya est[aá] reparado|ya est[aá] corregido|Hotfix instalado y verificado|LISTO \(verificado\)|Problema grande del EXE ya est[aá] reparado|Listo\. El fallo|Debes ver|Deber[ií]a abrir|FOCO.*listo|sin pantalla blanca|firstPaintWithoutReload|Redeploy hecho|Prueba autom[aá]tica)/i;
const userFailRe = /(NO FUNCIONA|sigue|otra vez|1200|fraude|pantalla en blanco|no hace nada|bloquead|OBEDIENCIA|FORENSIC|NaN%|no queda|estafa|cuarta vez|muchas veces|arreglas porque|no es verdad)/i;
const selfAdmitRe = /(no estaba arreglado|cierres prematuros|promet[ií] de m[aá]s|mismo ciclo|teatro|Sin test que falle primero)/i;
const claims = [];
const fails = [];
const admits = [];
let n = 0;
for (const line of fs.readFileSync(path, "utf8").split(/\n/)) {
  n += 1;
  if (!line.trim()) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  const role = o.role;
  const content = o.message && o.message.content;
  const texts = [];
  if (Array.isArray(content)) {
    for (const c of content) if (c && c.type === "text") texts.push(c.text || "");
  } else if (typeof content === "string") texts.push(content);
  const text = texts.join("\n");
  if (!text.trim()) continue;
  const uq = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  const body = uq ? uq[1] : text;
  const snip = (s) => String(s).replace(/\s+/g, " ").slice(0, 210);
  if (role === "assistant") {
    if (claimRe.test(text.slice(0, 3000))) claims.push({ n, s: snip(text) });
    if (selfAdmitRe.test(text)) admits.push({ n, s: snip(text) });
  }
  if (role === "user" && userFailRe.test(body)) fails.push({ n, s: snip(body) });
}
const out = {
  transcriptLines: n,
  assistantClosureClaims: claims.length,
  userFailureComplaints: fails.length,
  assistantSelfAdmits: admits.length,
  lastClaims: claims.slice(-15),
  lastFails: fails.slice(-15),
  lastAdmits: admits.slice(-10),
};
fs.writeFileSync("D:/PROGRAMAS IA/EDITCOREAI/.editcore/transcript-claim-audit.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  transcriptLines: out.transcriptLines,
  assistantClosureClaims: out.assistantClosureClaims,
  userFailureComplaints: out.userFailureComplaints,
  assistantSelfAdmits: out.assistantSelfAdmits,
}, null, 2));
console.log("---LAST_CLAIMS---");
for (const c of out.lastClaims) console.log("L" + c.n + ": " + c.s);
console.log("---LAST_FAILS---");
for (const c of out.lastFails) console.log("L" + c.n + ": " + c.s);
console.log("---LAST_ADMITS---");
for (const c of out.lastAdmits) console.log("L" + c.n + ": " + c.s);
