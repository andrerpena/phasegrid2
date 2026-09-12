import { Button } from "@renderer/components/buttons/Button";
import {
  Modal,
  ModalFrameStructured,
  useModalStore,
} from "@renderer/components/floating/modal";
import { Label } from "@renderer/components/form-controls";
import { TextInput } from "@renderer/components/form-controls/TextInput";
import { useProjectStore } from "@renderer/project/project-store";
import { slugify, uniqueSlug } from "@shared/protocol/workspace";
import { useEffect, useRef, useState } from "react";
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

  const close = () => hide(SAVE_AS_MODAL);

  return (
    <Modal open={open} onClose={close} size="sm">
      <ModalFrameStructured
        title="Save Project As"
        onClose={close}
        data-testid="save-as"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={trimmed.length === 0} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="save-as-name">Name</Label>
          <TextInput
            id="save-as-name"
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </div>
        {/* The folder name is shown as you type: it is what you will see in a file manager. */}
        <p className="mt-2 min-h-4 text-xs text-muted-foreground">
          {folder === "" ? " " : `projects/${folder}/`}
        </p>
      </ModalFrameStructured>
    </Modal>
  );
};
