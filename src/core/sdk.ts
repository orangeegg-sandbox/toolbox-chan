// The only core entry point tools may import. Everything else in core is private
// to the shell; `tests/boundaries.test.ts` enforces this.
export type { ToolDefinition, ToolShortcut, ToolSurfaceProps, ToolWindowDefinition, ToolboxRoute } from "./tools/contracts";
export { ToolPage, ToolPanel, SplitPane, EmptyState } from "./layout";
export { useToolbox } from "./ToolboxContext";
export { ToolCommandHandler, type ToolCommandDefinition } from "./commands/ToolCommandHandler";
export { useToolCommands } from "./commands/CommandProvider";
export { copyText, exportText } from "./platform/text";
export { notifyPet, subscribePetEvents, subscribePetVisibility, getPetState, runPetAction } from "./pet/petEvents";
export {
  AGENT_IDS, PET_EMOTES, PET_NOTICES, PET_STATUSES, petEventError,
  type AgentId, type PetAction, type PetBadge, type PetBadgeEntry, type PetDoorStatus, type PetEmote, type PetEvent,
  type PetMessage, type PetNotice, type PetState, type PetStatus,
} from "./pet/types";
