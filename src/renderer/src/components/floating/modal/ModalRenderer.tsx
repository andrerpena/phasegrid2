import { Modal } from "./Modal";
import { useModalStore } from "./modal-store";

/**
 * Draws the modals that have no component of their own.
 *
 * A command can open a dialog from anywhere -- there is no React tree at a command's call site -- so
 * it pushes a config onto the stack and this renders it. Modals that *are* components, like the Save
 * As sheet, register a name in the same stack and draw themselves; those have no `content` and are
 * skipped here.
 *
 * Mounted once, at the root.
 */
export const ModalRenderer = () => {
  const stack = useModalStore((s) => s.stack);
  const dismissModal = useModalStore((s) => s.dismissModal);

  return (
    <>
      {stack.map((instance) =>
        instance.content === null || instance.content === undefined ? null : (
          <Modal
            key={instance.id}
            open
            onClose={() => dismissModal(instance.id)}
            size={instance.size}
            alignment={instance.alignment}
            showBackdrop={instance.showBackdrop}
          >
            {instance.content}
          </Modal>
        ),
      )}
    </>
  );
};
