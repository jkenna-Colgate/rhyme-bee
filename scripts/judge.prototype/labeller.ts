/**
 * PROTOTYPE, throwaway (#231). Writes a single HTML file the maintainer opens by
 * double-click to label pairs by ear.
 *
 *   npx tsx scripts/judge.prototype/labeller.ts heldout              blind: no evidence, no ruling
 *   npx tsx scripts/judge.prototype/labeller.ts batch-1 <rulings>    review: the judge's ruling is shown
 *
 * Labels autosave in the browser and leave it through Export, as
 * `<set>.labels.json` in Downloads.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pair } from "./pool.ts";

const here = import.meta.dirname;
const [set, rulingsPath] = process.argv.slice(2);
if (!set) throw new Error("usage: labeller.ts <set> [rulings.json]");
const pairs: Pair[] = JSON.parse(readFileSync(resolve(here, `${set}.json`), "utf8"));
const rulings: Record<string, { verdict: string; confidence: string; why: string; reading?: string | null }> =
  rulingsPath ? JSON.parse(readFileSync(resolve(rulingsPath), "utf8")) : {};
const blind = !rulingsPath;

// Blind, the page gets the pair and the question and nothing the engine thinks.
const items = pairs.map((p) => ({
  id: p.id,
  word: p.word,
  seed: p.seedWord,
  say: p.seedRespelling,
  tier: p.kind === "tier",
  ...(blind ? {} : {
    kind: p.kind,
    engine: p.evidence.readings.map((r) => r.respelling).join(" / ") || "no reading",
    ruling: rulings[p.id] ?? null,
  }),
}));

const html = `<!doctype html>
<meta charset="utf-8">
<title>PROTOTYPE judge labels: ${set}</title>
<style>
  body { font: 17px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.1rem; margin: 0; } .intro { color: #555; font-size: .9rem; }
  .card { border: 1px solid #ccc; border-radius: 10px; padding: 1.5rem; margin: 1.2rem 0; }
  .pair { font-size: 2rem; } .pair b { color: #7a3ff2; } .say { color: #777; font-size: 1rem; }
  .q { margin: .6rem 0 1rem; color: #444; }
  button { font: inherit; padding: .5rem .9rem; margin: .2rem .3rem .2rem 0; border: 1px solid #999; border-radius: 8px; background: #fff; cursor: pointer; }
  button.on { background: #7a3ff2; color: #fff; border-color: #7a3ff2; }
  kbd { font-size: .75rem; border: 1px solid #aaa; border-radius: 4px; padding: 0 .3rem; margin-right: .3rem; }
  .ruling { background: #f4f0ff; border-radius: 8px; padding: .7rem 1rem; margin-bottom: 1rem; font-size: .92rem; }
  .state { font-size: .88rem; color: #555; } .nav button { font-size: .85rem; }
  table { border-collapse: collapse; font-size: .82rem; } td { padding: 0 .6rem 0 0; }
</style>
<h1>PROTOTYPE (#231): ${blind ? "blind labels" : "review of the judge's rulings"}, set <code>${set}</code></h1>
<p class="intro">${blind
    ? "Rule on each pair by ear, as you would in the Editor's Pass. Nothing the engine or a judge thinks is shown, on purpose: these labels are the ground truth the judge is scored against, and they are never used to tune it."
    : "The judge has ruled on each pair. Press Enter to agree, or pick the ruling you would have made. Your rulings become the tuning set."}
  Keys: number to rule, Enter to ${blind ? "skip forward" : "agree"}, Backspace to go back.</p>
<div class="state" id="progress"></div>
<div class="card" id="card"></div>
<div class="nav"><button id="back">Back</button><button id="next">Next</button><button id="export">Export labels</button></div>
<h1 style="margin-top:1.5rem">Rulings so far</h1>
<div class="state" id="tally"></div>
<table id="log"></table>
<script>
const SET = ${JSON.stringify(set)};
const ITEMS = ${JSON.stringify(items)};
const KEY = "PROTOTYPE-judge-labels-" + SET;
const RHYME = [["rhymes", "Rhymes: should count"], ["weak", "Weak: same sounds, stress falls earlier"], ["no-rhyme", "Does not rhyme"], ["not-a-word", "Not a word, or a name"], ["unsure", "Unsure"]];
const TIER = [["answer", "Answer"], ["bonus", "Bonus Word"], ["not-a-word", "Not a word, or a name"], ["unsure", "Unsure"]];
let labels = JSON.parse(localStorage.getItem(KEY) || "{}");
let at = Math.max(0, ITEMS.findIndex((it) => !labels[it.id]));
if (ITEMS.every((it) => labels[it.id])) at = ITEMS.length - 1;
const options = (it) => (it.tier ? TIER : RHYME);

function rule(label) {
  labels[ITEMS[at].id] = label;
  localStorage.setItem(KEY, JSON.stringify(labels));
  if (at < ITEMS.length - 1) at++;
  render();
}
function render() {
  const it = ITEMS[at], done = ITEMS.filter((x) => labels[x.id]).length;
  document.getElementById("progress").textContent = "Pair " + (at + 1) + " of " + ITEMS.length + ". Ruled: " + done + (done === ITEMS.length ? ". All done: press Export labels." : "");
  const q = it.tier
    ? "The game accepts this as a <b>Bonus Word</b> (unscored). Would a player hunting rhymes think of it, so that it should be an Answer?"
    : "Does <b>" + it.word + "</b> rhyme with the Seed Word in General American?";
  const r = it.ruling;
  document.getElementById("card").innerHTML =
    '<div class="pair">' + it.word + ' <span class="say">for</span> <b>' + it.seed + '</b> <span class="say">' + (it.say ? "(" + it.say + ")" : "") + "</span></div>" +
    '<div class="q">' + q + "</div>" +
    (r ? '<div class="ruling">Judge: <b>' + r.verdict + "</b> (" + r.confidence + ")" + (r.reading ? ", reading <code>" + r.reading + "</code>" : "") + "<br>" + r.why + "<br><span class=say>Engine: " + it.kind + ", reads it " + it.engine + "</span></div>" : "") +
    options(it).map(([v, text], i) => '<button data-v="' + v + '" class="' + (labels[it.id] === v ? "on" : "") + '"><kbd>' + (i + 1) + "</kbd>" + text + "</button>").join("");
  document.querySelectorAll("#card button").forEach((b) => (b.onclick = () => rule(b.dataset.v)));
  const tally = {};
  Object.values(labels).forEach((l) => (tally[l] = (tally[l] || 0) + 1));
  document.getElementById("tally").textContent = Object.entries(tally).map(([l, n]) => l + " " + n).join(", ") || "none yet";
  document.getElementById("log").innerHTML = ITEMS.filter((x) => labels[x.id]).slice(-12).reverse()
    .map((x) => "<tr><td>" + x.word + "</td><td>for " + x.seed + "</td><td><b>" + labels[x.id] + "</b></td></tr>").join("");
}
document.getElementById("back").onclick = () => { at = Math.max(0, at - 1); render(); };
document.getElementById("next").onclick = () => { at = Math.min(ITEMS.length - 1, at + 1); render(); };
document.getElementById("export").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(labels, null, 1)], { type: "application/json" }));
  a.download = SET + ".labels.json";
  a.click();
};
document.onkeydown = (e) => {
  const it = ITEMS[at], n = Number(e.key);
  if (n >= 1 && n <= options(it).length) rule(options(it)[n - 1][0]);
  else if (e.key === "Enter") { if (it.ruling && !labels[it.id]) rule(it.ruling.verdict); else document.getElementById("next").click(); }
  else if (e.key === "Backspace") document.getElementById("back").click();
};
render();
</script>
`;
const out = resolve(here, `label-${set}.html`);
writeFileSync(out, html);
console.log(out, items.length, "pairs", blind ? "(blind)" : "(review)");
