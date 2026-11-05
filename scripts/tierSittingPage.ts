/**
 * The Tier sitting's page (#309): a single static HTML file the draw command
 * writes, and a thin shell over `src/tierSitting.ts`. Untested by design.
 *
 * It shows one word at a time with its Seed Word, in the drawn (shuffled)
 * order, and never its knownness: the page holds no knownness to show. Marks
 * are taken by button or key (E, H, B), can be changed by stepping back, are
 * kept in the browser across a reload, and are saved as a label set asking
 * the tier question, for `data/judge-labels/`.
 */

import type { SittingItem } from "../src/tierSitting.ts";

export interface SittingPage {
  set: string;
  labeller: string;
  /** The built index the sample was drawn from, so a sample is never mixed with another build's. */
  indexHash: string;
  seed: number;
  items: SittingItem[];
}

/** JSON safe to place inside a `<script>` element. */
const embed = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function sittingPage(page: SittingPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tier sitting: ${page.set}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  .prompt { font-size: 1.1rem; color: #555; }
  .word { font-size: 2.6rem; font-weight: 600; margin: 0.4rem 0 1.4rem; }
  .marks button { font-size: 1.1rem; padding: 0.7rem 1rem; margin-right: 0.5rem; border: 2px solid #999; border-radius: 6px; background: #fff; cursor: pointer; }
  .marks button.on { border-color: #222; background: #222; color: #fff; }
  .nav { margin: 1.4rem 0; }
  .strip { display: flex; flex-wrap: wrap; gap: 3px; margin: 1rem 0; }
  .strip span { width: 12px; height: 12px; border-radius: 2px; background: #ddd; cursor: pointer; }
  .strip span.easy { background: #4a8; } .strip span.hard-find { background: #db4; } .strip span.bonus { background: #c55; }
  .strip span.here { outline: 2px solid #222; }
  dl { font-size: 0.9rem; color: #555; } dt { font-weight: 600; } dd { margin: 0 0 0.5rem 0; }
  footer { margin-top: 2rem; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Tier sitting</h1>
<p id="progress"></p>
<p class="prompt">hunting rhymes for <strong id="seed"></strong>:</p>
<p class="word" id="word"></p>
<div class="marks">
  <button data-mark="easy"><u>E</u>asy</button>
  <button data-mark="hard-find"><u>H</u>ard find</button>
  <button data-mark="bonus"><u>B</u>onus</button>
</div>
<div class="nav">
  <button id="prev">&larr; back</button>
  <button id="next">next &rarr;</button>
  <button id="unmarked">next unmarked</button>
</div>
<div class="strip" id="strip"></div>
<dl>
  <dt>E (easy)</dt><dd>Most players would think of it.</dd>
  <dt>H (hard find)</dt><dd>Some would, with effort.</dd>
  <dt>B (Bonus)</dt><dd>A real word nobody hunting rhymes would come up with.</dd>
</dl>
<footer>
  <label>Labeller <input id="labeller"></label>
  <button id="save">Save marks</button>
  <p>Saves <code>${page.set}.json</code>. Put it in <code>data/judge-labels/</code>, commit it, and run <code>npm run tier:place</code>.
  Keys: E, H, B mark; &larr; and &rarr; step.</p>
</footer>
<script>
const SITTING = ${embed({ set: page.set, labeller: page.labeller, indexHash: page.indexHash, seed: page.seed, items: page.items })};
const KEY = "rhyme-bee:tier-sitting:" + SITTING.set + ":" + SITTING.indexHash;
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
let state = { at: 0, labeller: SITTING.labeller, marks: {} };
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.marks) state = saved; } catch (e) {}
const keep = () => localStorage.setItem(KEY, JSON.stringify(state));
const $ = (id) => document.getElementById(id);

function render() {
  const item = SITTING.items[state.at];
  $("seed").textContent = item.seedWord;
  $("word").textContent = item.word;
  const mark = state.marks[item.word];
  for (const b of document.querySelectorAll(".marks button")) b.classList.toggle("on", mark && b.dataset.mark === mark.verdict);
  const done = SITTING.items.filter((i) => state.marks[i.word]).length;
  $("progress").textContent = "Word " + (state.at + 1) + " of " + SITTING.items.length + ", " + done + " marked";
  const strip = $("strip");
  strip.innerHTML = "";
  SITTING.items.forEach((i, n) => {
    const s = document.createElement("span");
    if (state.marks[i.word]) s.className = state.marks[i.word].verdict;
    if (n === state.at) s.classList.add("here");
    s.title = String(n + 1);
    s.onclick = () => go(n);
    strip.appendChild(s);
  });
  $("labeller").value = state.labeller;
}
function go(n) { state.at = Math.max(0, Math.min(SITTING.items.length - 1, n)); keep(); render(); }
function nextUnmarked() {
  const n = SITTING.items.length;
  for (let step = 1; step <= n; step++) { const i = (state.at + step) % n; if (!state.marks[SITTING.items[i].word]) return go(i); }
  render();
}
function mark(verdict) {
  state.marks[SITTING.items[state.at].word] = { verdict, on: today() };
  keep();
  nextUnmarked();
}
function save() {
  const labeller = state.labeller.trim();
  if (!labeller) { alert("Name the labeller first."); return; }
  const set = {
    set: SITTING.set,
    question: "tier",
    labelledBy: [labeller],
    labelledOn: today(),
    blind: true,
    rules: ["#307"],
    tuning: false,
    notes: [
      "The Tier sitting (#309): Answers drawn from the scheduled days, about 15 per 0.25 band of knownness, marked with knownness hidden.",
      "easy: most players would think of it. hard-find: some would, with effort. bonus: a real word nobody hunting rhymes would come up with.",
      "Drawn from index " + SITTING.indexHash + " with seed " + SITTING.seed + ".",
    ],
    pairs: SITTING.items.map((i) => {
      const m = state.marks[i.word];
      return { word: i.word, seedWord: i.seedWord, seedReading: null, rhymeKeyWhenCut: i.rhymeKey,
        verdicts: m ? [{ labeller, verdict: m.verdict, on: m.on, blind: true }] : [] };
    }),
  };
  const lines = JSON.stringify(set, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines + "\\n"], { type: "application/json" }));
  a.download = SITTING.set + ".json";
  a.click();
}

for (const b of document.querySelectorAll(".marks button")) b.onclick = () => mark(b.dataset.mark);
$("prev").onclick = () => go(state.at - 1);
$("next").onclick = () => go(state.at + 1);
$("unmarked").onclick = nextUnmarked;
$("save").onclick = save;
$("labeller").oninput = (e) => { state.labeller = e.target.value; keep(); };
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === "e") mark("easy");
  else if (k === "h") mark("hard-find");
  else if (k === "b") mark("bonus");
  else if (e.key === "ArrowLeft") go(state.at - 1);
  else if (e.key === "ArrowRight") go(state.at + 1);
});
render();
</script>
</body>
</html>
`;
}
