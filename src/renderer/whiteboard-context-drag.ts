// Only an opaque persisted Whiteboard node ID crosses the renderer drag boundary.
// The main process resolves its current project and file or folder reference on each action.
// Keep the MIME value for existing renderer drops; it carries only the node ID.
export const WHITEBOARD_CONTEXT_DRAG_TYPE = 'application/x-branchloom-whiteboard-file';
