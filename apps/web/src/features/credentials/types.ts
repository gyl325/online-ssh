export type CredentialAuthType = "password" | "private_key";
export type CredentialKeyPairAlgorithm = "ed25519" | "ecdsa" | "rsa";

export type Credential = {
  id: string;
  name: string;
  auth_type: CredentialAuthType;
  has_secret?: boolean;
  has_private_key?: boolean;
  has_passphrase?: boolean;
  key_version: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type CredentialListResponse = {
  items: Credential[];
  page: number;
  page_size: number;
  total: number;
};

export type CredentialResponse = {
  credential: Credential;
};

export type CreateCredentialInput = {
  name: string;
  auth_type: CredentialAuthType;
  password?: string;
  private_key?: string;
  passphrase?: string;
};

export type UpdateCredentialInput = {
  name?: string;
  password?: string;
  private_key?: string;
  passphrase?: string;
};

export type GenerateCredentialKeyPairInput = {
  algorithm: CredentialKeyPairAlgorithm;
  comment?: string;
};

export type GeneratedCredentialKeyPair = {
  algorithm: CredentialKeyPairAlgorithm;
  private_key: string;
  public_key: string;
  authorized_key_line: string;
  deploy_command: string;
};

export type GeneratedCredentialKeyPairResponse = {
  key_pair: GeneratedCredentialKeyPair;
};
