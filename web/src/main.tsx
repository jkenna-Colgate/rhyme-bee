import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// No StrictMode: the shell's mount effects drive a real ~14 MB fetch and (from
// issue #36) speech synthesis, both of which must fire exactly once.
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App />);
