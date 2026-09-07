import { commandRegistry } from "@renderer/commands/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../floating/modal/Modal";
import styles from "./CommandPalette.module.css";
import { rankCommands } from "./filter";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** Type to find a command, enter to run it. The keyboard route to everything the application can do. */
export const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => rankCommands(commandRegistry.runnable(), query),
    [query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    // The dialog moves focus to itself when it opens, so this has to run after that.
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const run = (index: number) => {
    const hit = results[index];
    if (hit === undefined) return;
    onClose();
    void commandRegistry.dispatch(hit.command.id);
  };

  return (
    <Modal open={open} onClose={onClose} title="Commands" size="md">
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder="Type a command"
        aria-label="Search commands"
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelected((s) => Math.min(s + 1, results.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            run(selected);
          }
        }}
      />
      <ul className={styles.list}>
        {results.map((hit, index) => (
          <li key={hit.command.id}>
            <button
              type="button"
              className={styles.item}
              aria-current={index === selected}
              // Pointer down rather than click: a click would first blur the input, and the blur can
              // close the palette before the click lands.
              onPointerDown={(event) => {
                event.preventDefault();
                run(index);
              }}
              onMouseEnter={() => setSelected(index)}
            >
              <span className={styles.name}>{hit.command.name}</span>
              <span className={styles.id}>{hit.command.id}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && (
          <li className={styles.empty}>No matching command</li>
        )}
      </ul>
    </Modal>
  );
};
