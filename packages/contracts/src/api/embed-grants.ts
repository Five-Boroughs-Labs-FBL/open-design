export interface CreateProjectEmbedGrantRequest {
  userId: string;
  ttlSec?: number;
}

export interface CreateProjectEmbedGrantResponse {
  projectId: string;
  userId: string;
  token: string;
  expiresAt: string; // ISO-8601
}

/** Catalog / account grant — lists every Open Design project tied to this ACP user. */
export const CATALOG_EMBED_GRANT_PID = '*';

export interface CreateCatalogEmbedGrantRequest {
  userId: string;
  ttlSec?: number;
  /** Legacy OD project ids that predate `metadata.acpUserId`. */
  projectIds?: string[];
  /** ACP admin catalog sessions may persist process-wide host settings. */
  admin?: boolean;
  /** SuperGrok auth.json packed from the ACP user vault. Server-token only. */
  amcGrok?: {
    authJson?: string;
  };
  /** Admin MiniMax key packed from the ACP vault. Server-token only. */
  amcMinimax?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

export interface CreateCatalogEmbedGrantResponse {
  projectId: typeof CATALOG_EMBED_GRANT_PID;
  userId: string;
  projectIds: string[];
  token: string;
  expiresAt: string; // ISO-8601
  admin: boolean;
}

export interface PublicRuntimeEmbedSession {
  uid: string;
  catalog: boolean;
  admin: boolean;
}

export interface PublicRuntimeResponse {
  acpSsoUrl: string | null;
  embedSession: PublicRuntimeEmbedSession | null;
}

export interface EmbedGrantPublic {
  uid: string;
  catalog: boolean;
  admin: boolean;
}

export interface EmbedSessionLogoutResponse {
  ok: true;
  redirectTo: string;
}
