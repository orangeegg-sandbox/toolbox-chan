import { AGENT_IDS, type AgentId } from "../../core/sdk";

export interface PetCharacter {
  agent: AgentId;
  /** The pet's own name. */
  name: string;
  /** The coding agent it watches. */
  agentName: string;
  /** Who drew the character the pet is based on. */
  artist: string;
}

export const PETS: readonly PetCharacter[] = [
  { agent: "claude", name: "Claude-Chan", agentName: "Claude Code", artist: "Ninon" },
  { agent: "codex", name: "Codex-Chan", agentName: "Codex", artist: "ZipZipPipe" },
  { agent: "deepseek", name: "DeepSeek-Chan", agentName: "DeepSeek Harness (DSH)", artist: "ZipZipPipe (sheet watermark @amemily2050)" },
];

export const PET_BY_AGENT = Object.fromEntries(PETS.map((pet) => [pet.agent, pet])) as Record<AgentId, PetCharacter>;

export { AGENT_IDS };
