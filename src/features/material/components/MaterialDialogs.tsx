// Stable public entrypoint for material dialogs. Implementations are grouped
// by responsibility so changes to importing, claiming, and shared controls do
// not expand one monolithic component module.
export {
  BatchClaimDialog,
  BatchCompletionDialog,
  ClaimDialog,
  QuickClaimDialog
} from "./MaterialClaimDialogs";
export {
  EditProjectDialog,
  ImportProjectDialog
} from "./MaterialProjectDialogs";
export {
  formatCount,
  MaterialIcon,
  StarPicker,
  type BatchClaimItem
} from "./MaterialPrimitives";
