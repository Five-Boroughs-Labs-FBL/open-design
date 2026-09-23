import type { WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import type { AppConfig } from '../types';

export interface AcpDesignExecution {
  agentId: string;
  model: string;
  reasoning: string | null;
}

/** Keep API-mode and another provider's model/effort out of ACP Design turns. */
export function applyAcpDesignExecution(
  config: AppConfig,
  execution: AcpDesignExecution,
): AppConfig {
  return {
    ...config,
    mode: 'daemon',
    agentId: execution.agentId,
    ...(execution.agentId === 'byok-opencode' ? { model: execution.model } : {}),
    agentModels: {
      ...config.agentModels,
      [execution.agentId]: {
        model: execution.model,
        ...(execution.reasoning ? { reasoning: execution.reasoning } : {}),
      },
    },
  };
}

/** ACP's Design handoff, not the standalone studio default, owns this turn. */
export async function readAcpDesignExecution(
  projectId: string,
  conversationId: string,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<AcpDesignExecution> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/acp-design-execution`,
    {
      headers: workspaceContext ? workspaceProjectHeaders(workspaceContext) : undefined,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not read the current ACP Design setting. Try again after ACP is available.');
  const execution = await response.json() as AcpDesignExecution | null;
  if (!execution || typeof execution.agentId !== 'string' || !execution.agentId.trim()
    || typeof execution.model !== 'string' || !execution.model.trim()
    || (execution.reasoning != null && typeof execution.reasoning !== 'string')) {
    throw new Error('ACP Design model selection is unavailable. Reopen Design from ACP before retrying.');
  }
  return { agentId: execution.agentId, model: execution.model, reasoning: execution.reasoning ?? null };
}
