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
