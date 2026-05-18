import type { Credential, CredentialAuthType } from "../credentials/types";
import type { Host } from "../hosts/types";

export type QuickConnectionKeyType = "auto" | "rsa" | "ed25519" | "ecdsa";

export type QuickConnectInput = {
  auth_type: CredentialAuthType;
  credential_id?: string;
  credential_name?: string;
  group_id?: string | null;
  host: string;
  is_favorite: boolean;
  name: string;
  passphrase?: string;
  password?: string;
  port: number;
  private_key?: string;
  username: string;
};

export type QuickConnectResponse = {
  credential: Credential;
  created_credential: boolean;
  host: Host;
};

export type TemporaryConnectionInput = {
  auth_type: CredentialAuthType;
  credential_id?: string;
  host: string;
  key_type?: QuickConnectionKeyType;
  passphrase?: string;
  password?: string;
  port: number;
  private_key?: string;
  username: string;
};

export type TemporaryConnectionResponse = {
  host: Host;
};
