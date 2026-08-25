/**
 * The Editor's Pass tab strip.
 *
 * The screen used to stack its panels down one page — status, then the
 * Candidate Queue, then the day. That reads as one long scroll in which the day
 * readout, the thing the pass is actually about, is the part furthest from the
 * top. #186 adds a fourth panel, which makes the stack untenable, so the panels
 * become tabs and the day is the one that opens.
 *
 * Which tab is showing is shell state and not a route. The Editor's Pass has no
 * router, this does not introduce one, and the URL is not somewhere an editor
 * ever needs to come back to — the day is chosen by the date control, which is
 * chrome above the strip and survives every switch.
 *
 * No panel fetches anything of its own, so switching tabs cannot re-request
 * anything: every hook on the screen is held by the shell, above this strip, and
 * goes on holding what it fetched while its panel is unmounted.
 *
 * The strip follows the WAI-ARIA tabs pattern with automatic activation: arrows
 * move the selection and the focus together, Home and End jump to the ends, and
 * a roving `tabIndex` keeps the strip a single Tab stop.
 */

import { useRef, type ReactNode } from "react";

export type EditorTab = "day" | "queue" | "status";

const TABS: { id: EditorTab; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "queue", label: "Candidate Queue" },
  { id: "status", label: "Status" },
];

function tabId(tab: EditorTab): string {
  return `editor-tab-${tab}`;
}

function panelId(tab: EditorTab): string {
  return `editor-panel-${tab}`;
}

/**
 * One panel, shown only when its tab is the selected one.
 *
 * The wiring that pairs a panel with its tab — the two ids, the `role`, the
 * `aria-labelledby`, the `tabIndex` that lets the strip hand focus over — is
 * here rather than at each call site so a panel cannot be added with half of it.
 * #186 adds a fourth, and a fourth panel that renders but announces itself as
 * the third is exactly the defect this shape rules out.
 */
export function TabPanel({
  tab,
  selected,
  children,
}: {
  tab: EditorTab;
  selected: EditorTab;
  children: ReactNode;
}) {
  if (tab !== selected) return null;
  return (
    <section id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={0}>
      {children}
    </section>
  );
}

export function EditorTabs({
  selected,
  onSelect,
}: {
  selected: EditorTab;
  onSelect: (tab: EditorTab) => void;
}) {
  const buttons = useRef(new Map<EditorTab, HTMLButtonElement>());

  // Selection and focus move together, so the panel under an arrow key is the
  // one the screen reader is about to be told about.
  const moveTo = (index: number) => {
    const tab = TABS[(index + TABS.length) % TABS.length];
    if (tab === undefined) return;
    onSelect(tab.id);
    buttons.current.get(tab.id)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const here = TABS.findIndex((tab) => tab.id === selected);
    if (event.key === "ArrowRight") moveTo(here + 1);
    else if (event.key === "ArrowLeft") moveTo(here - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(TABS.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="editor-tabs" role="tablist" aria-label="Editor’s Pass panels" onKeyDown={onKeyDown}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          aria-selected={tab.id === selected}
          aria-controls={panelId(tab.id)}
          tabIndex={tab.id === selected ? 0 : -1}
          ref={(node) => {
            if (node === null) buttons.current.delete(tab.id);
            else buttons.current.set(tab.id, node);
          }}
          className={tab.id === selected ? "editor-tab editor-tab-on" : "editor-tab"}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
