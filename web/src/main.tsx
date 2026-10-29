import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startSessionRecords } from "./sessionRecords.ts";
import "./styles.css";

// Session Records (ADR-0019): sends stored Daily Puzzle Sessions on load and
// when the page is hidden. It reads storage only and never waits on the game,
// and a production build is the only one that sends.
startSessionRecords();

// No StrictMode: the shell's mount effects drive a real ~14 MB fetch and (from
// issue #36) speech synthesis, both of which must fire exactly once.
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App />);
