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
}

export interface CreateCatalogEmbedGrantResponse {
  projectId: typeof CATALOG_EMBED_GRANT_PID;
  userId: string;
  projectIds: string[];
  token: string;
  expiresAt: string; // ISO-8601
}

export interface PublicRuntimeResponse {
  acpSsoUrl: string | null;
}

export interface EmbedGrantPublic {
  uid: string;
  catalog: boolean;
}
