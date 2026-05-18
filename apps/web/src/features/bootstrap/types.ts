import type { AuthUserResponse } from "../auth/types";

export type BootstrapStatus = {
  setup_required: boolean;
  setup_token_required?: boolean;
};

export type BootstrapSetupInput = {
  email: string;
  display_name: string;
  password: string;
  password_confirm: string;
  setup_token?: string;
};

export type BootstrapSetupResponse = AuthUserResponse;
