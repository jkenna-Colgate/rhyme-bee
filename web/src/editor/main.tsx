/**
 * The Editor's Pass's entry point, and deliberately **not** a route in the
 * player's app (ADR-0016). `web/editor.html` loads this and nothing else loads
 * it, so the player's shell gains no router, no route guard and no dead code,
 * and the editor is absent from a production build because `vite.config.ts`
 * names `index.html` as the build's only input.
 *
 * Nothing here loads the Rhyme Index or mounts `PuzzleView`. The pass is a
 * *read*, not a play: the editor never opens a Session, so none of the player's
 * machinery is on this page.
 */

import { createRoot } from "react-dom/client";
import { EditorApp } from "./EditorApp.tsx";
import "./editor.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<EditorApp />);
