import { request } from "../../shared/api/http";
import type {
  CreateCredentialInput,
  GenerateCredentialKeyPairInput,
  GeneratedCredentialKeyPairResponse,
  CredentialListResponse,
  CredentialResponse,
  UpdateCredentialInput
} from "./types";

export function listCredentials(authType?: string) {
  return request<CredentialListResponse>({
    path: "/api/credentials",
    query: {
      page: 1,
      page_size: 100,
      auth_type: authType || undefined
    }
  });
}

export function getCredential(credentialId: string) {
  return request<CredentialResponse>({
    path: `/api/credentials/${credentialId}`
  });
}

export function createCredential(input: CreateCredentialInput) {
  return request<CredentialResponse>({
    method: "POST",
    path: "/api/credentials",
    body: input
  });
}

export function generateCredentialKeyPair(input: GenerateCredentialKeyPairInput) {
  return request<GeneratedCredentialKeyPairResponse>({
    method: "POST",
    path: "/api/credentials/keypairs",
    body: input
  });
}

export function updateCredential(credentialId: string, input: UpdateCredentialInput) {
  return request<CredentialResponse>({
    method: "PUT",
    path: `/api/credentials/${credentialId}`,
    body: input
  });
}

export function deleteCredential(credentialId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/credentials/${credentialId}`,
    responseType: "void"
  });
}
