import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startSessionRecords } from "./sessionRecords.ts";
import { indexLoadSettled } from "./useRhymeIndex.ts";
import "./styles.css";

// No StrictMode: the shell's mount effects drive a real ~14 MB fetch and (from
// issue #36) speech synthesis, both of which must fire exactly once.
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App />);

// Session Records (ADR-0019): sends stored Daily Puzzle Sessions once the game
// has loaded and the page is idle, and again when the page is hidden. Started
// after the first render and never waited on, so sending cannot delay play; a
// production build is the only one that sends.
startSessionRecords(indexLoadSettled);
