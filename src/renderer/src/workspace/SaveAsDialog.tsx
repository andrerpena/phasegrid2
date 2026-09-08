import { Button } from "@renderer/components/buttons/Button";
import { Modal } from "@renderer/components/floating/modal/Modal";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { useProjectStore } from "@renderer/project/project-store";
import { slugify, uniqueSlug } from "@shared/protocol/workspace";
import { useEffect, useRef, useState } from "react";
import styles from "./SaveAsDialog.module.css";
import { useWorkspaceStore } from "./workspace-store";

export const SAVE_AS_MODAL = "project.saveAs";

/**
 * Naming a project.
 *
 * In-app rather than a native save panel, because the answer always goes in the same place: a folder
 * inside the workspace. A save panel that let you point anywhere would be offering something the
 * application cannot honour, and the workspace would become a suggestion.
 *
 * The folder name is shown while you type. It is the thing you will see in a file manager, and deriving
 * it silently is how people end up with a folder called `untitled` they cannot account for.
 */
export const SaveAsDialog = () => {
  const open = useModalStore((s) => s.isOpen(SAVE_AS_MODAL));
  const hide = useModalStore((s) => s.hide);
  const activeId = useProjectStore((s) => s.activeId);
  const project = useProjectStore((s) => s.active());
  const saveProjectAs = useWorkspaceStore((s) => s.saveProjectAs);
  const takenSlugs = useWorkspaceStore((s) => s.takenSlugs);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Re-seeded each time it opens, so it offers the project's current name rather than whatever was
  // typed into it last time. Selected rather than merely focused, because the offered name is usually
  // either exactly right or entirely wrong.
  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "Untitled");
    input.current?.select();
  }, [open, project?.name]);

  const trimmed = name.trim();
  const folder =
    trimmed.length === 0
      ? ""
      : uniqueSlug(
          slugify(trimmed),
          takenSlugs().filter((s) => s !== project?.slug),
        );

  const submit = (): void => {
    if (activeId === null || trimmed.length === 0) return;
    void saveProjectAs(activeId, trimmed).then((saved) => {
      if (saved) hide(SAVE_AS_MODAL);
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => hide(SAVE_AS_MODAL)}
      title="Save Project As"
      size="sm"
      footer={
        <>
          <Button onClick={() => hide(SAVE_AS_MODAL)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={trimmed.length === 0}
            onClick={submit}
          >
            Save
          </Button>
        </>
      }
    >
      <label className={styles.field}>
        <span className={styles.caption}>Name</span>
        <input
          ref={input}
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </label>
      <p className={styles.folder}>
        {folder === "" ? " " : `projects/${folder}/`}
      </p>
    </Modal>
  );
};
