/**
 * PROTOTYPE, throwaway (#231). Writes a single HTML file the maintainer opens by
 * double-click, holding only the pairs the rules of #232 could not decide.
 *
 *   npx tsx scripts/judge.prototype/labeller.ts heldout-2
 *
 * The page asks about Points and nothing else: is the pair a Rhyme, given the
 * right reading. It never asks whether a pair is a Weak Rhyme, it never asks
 * about wordhood or Tier, and the shape #232 did not rule is not on it. Each
 * card shows the pair in both directions and takes one ruling for both, since
 * a Rhyme that held one way only would break the substitution property.
 *
 * Labels autosave in the browser and leave it through Export, as
 * `<set>.labels.json` in Downloads. They go in labels/ beside the rule labels.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pair } from "./pool.ts";
import type { Decision } from "./rules.ts";

const here = import.meta.dirname;
const [set] = process.argv.slice(2);
if (!set) throw new Error("usage: labeller.ts <set>");
const pairs: (Pair & { rule: Decision })[] = JSON.parse(readFileSync(resolve(here, `${set}.json`), "utf8"));
const asked = pairs.filter((p) => p.rule.verdict === "ask");

// No judge ruling is on the page. The one piece of evidence shown is why the rules stopped.
const items = asked.map((p) => ({ id: p.id, word: p.word, seed: p.seedWord, say: p.seedRespelling, why: p.rule.why }));

const html = `<!doctype html>
<meta charset="utf-8">
<title>PROTOTYPE judge labels: ${set}</title>
<style>
  body { font: 17px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.1rem; margin: 0; } .intro { color: #555; font-size: .9rem; }
  .rule { background: #f6f6f6; border-radius: 8px; padding: .8rem 1rem; font-size: .9rem; margin: 1rem 0; }
  .rule li { margin: .2rem 0; }
  .card { border: 1px solid #ccc; border-radius: 10px; padding: 1.5rem; margin: 1.2rem 0; }
  .pair { font-size: 1.7rem; line-height: 1.35; } .pair b { color: #7a3ff2; } .say { color: #777; font-size: 1rem; }
  .why { margin: .8rem 0 1rem; color: #444; font-size: .92rem; }
  button { font: inherit; padding: .5rem .9rem; margin: .25rem 0; border: 1px solid #999; border-radius: 8px; background: #fff; cursor: pointer; display: block; width: 100%; text-align: left; }
  button small { display: block; color: #666; } button.on { background: #7a3ff2; color: #fff; border-color: #7a3ff2; } button.on small { color: #e6dcff; }
  .nav button { display: inline-block; width: auto; font-size: .85rem; margin-right: .3rem; }
  kbd { font-size: .75rem; border: 1px solid #aaa; border-radius: 4px; padding: 0 .3rem; margin-right: .4rem; }
  .state { font-size: .88rem; color: #555; }
  table { border-collapse: collapse; font-size: .82rem; } td { padding: 0 .6rem 0 0; }
</style>
<h1>PROTOTYPE (#231): the pairs the rules could not decide, set <code>${set}</code></h1>
<p class="intro">${pairs.length} pairs are in this set. The rules labelled ${pairs.length - asked.length} of them with nobody's ear. These ${asked.length} are left, each because a fact about how a word is said is missing. No judge ruling is shown.</p>
<div class="rule">
  <b>The one question: is the pair a Rhyme?</b> A Rhyme is what scores Points.
  <ul>
    <li>One word has a stressed syllable, main or secondary, whose vowel and everything after it are identical to the other word's from its last stressed vowel on. The consonants before the vowel are ignored.</li>
    <li>One differing sound is no Rhyme. An extra or missing syllable is no Rhyme.</li>
    <li>A match on an unstressed last syllable is no Rhyme. Whether it is accepted without Points is not asked here.</li>
    <li>Counted as the same: weak "ih" and weak "uh" after the stressed vowel; "er" and plain r after "eye", "ow" or "oy".</li>
    <li>A compound keeps a stress on its last part (<code>carsick</code>, <code>drumstick</code>).</li>
  </ul>
  Each card shows the pair both ways and takes one ruling for both. Whether the word deserves to be an Answer or a Bonus Word is not asked.
</div>
<p class="intro">Keys: 1, 2 or 3 to rule, Enter to skip forward, Backspace to go back.</p>
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
const OPTIONS = [
  ["rhyme", "Rhyme", "Scores Points, in both directions."],
  ["no-rhyme", "Not a Rhyme", "No Points in either direction. It may still be accepted without Points; the engine works that out."],
  ["out", "Leave it out", "I do not know how the word is said, or it is the lunatic shape. No label is written and no judge is scored on it."],
];
let labels = JSON.parse(localStorage.getItem(KEY) || "{}");
let at = Math.max(0, ITEMS.findIndex((it) => !labels[it.id]));
if (ITEMS.every((it) => labels[it.id])) at = ITEMS.length - 1;

function rule(label) {
  labels[ITEMS[at].id] = label;
  localStorage.setItem(KEY, JSON.stringify(labels));
  if (at < ITEMS.length - 1) at++;
  render();
}
function render() {
  const it = ITEMS[at], done = ITEMS.filter((x) => labels[x.id]).length;
  document.getElementById("progress").textContent = "Pair " + (at + 1) + " of " + ITEMS.length + ". Ruled: " + done + (done === ITEMS.length ? ". All done: press Export labels." : "");
  document.getElementById("card").innerHTML =
    '<div class="pair">' + it.word + ' <span class="say">for</span> <b>' + it.seed + '</b> <span class="say">' + (it.say ? "(" + it.say + ")" : "") + "</span><br>" +
    "<b>" + it.seed + '</b> <span class="say">for</span> ' + it.word + "</div>" +
    '<div class="why">Why the rules stopped: ' + it.why + ".</div>" +
    OPTIONS.map(([v, text, causes], i) => '<button data-v="' + v + '" class="' + (labels[it.id] === v ? "on" : "") + '"><kbd>' + (i + 1) + "</kbd>" + text + "<small>" + causes + "</small></button>").join("");
  document.querySelectorAll("#card button").forEach((b) => (b.onclick = () => rule(b.dataset.v)));
  const tally = {};
  Object.values(labels).forEach((l) => (tally[l] = (tally[l] || 0) + 1));
  document.getElementById("tally").textContent = Object.entries(tally).map(([l, n]) => l + " " + n).join(", ") || "none yet";
  document.getElementById("log").innerHTML = ITEMS.filter((x) => labels[x.id]).slice(-12).reverse()
    .map((x) => "<tr><td>" + x.word + " for " + x.seed + ", " + x.seed + " for " + x.word + "</td><td><b>" + labels[x.id] + "</b></td></tr>").join("");
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
  const n = Number(e.key);
  if (n >= 1 && n <= OPTIONS.length) rule(OPTIONS[n - 1][0]);
  else if (e.key === "Enter") document.getElementById("next").click();
  else if (e.key === "Backspace") document.getElementById("back").click();
};
render();
</script>
`;
const out = resolve(here, `label-${set}.html`);
writeFileSync(out, html);
console.log(out, items.length, "of", pairs.length, "pairs shown");
