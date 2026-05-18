import { request } from "../../shared/api/http";
import type {
  ChangeAccountEmailInput,
  ChangeAccountEmailResponse,
  ChangeAccountPasswordInput,
  ChangeAccountPasswordResponse,
  ConfirmMfaSetupInput,
  DeleteAccountInput,
  MfaRecoveryCodesResponse,
  MfaStatusResponse,
  SendAccountEmailCodeInput,
  SetupMfaInput,
  SetupMfaResponse,
  VerifyMfaWithPasswordInput
} from "./types";

export function changeAccountPassword(input: ChangeAccountPasswordInput) {
  return request<ChangeAccountPasswordResponse>({
    method: "PATCH",
    path: "/api/account/password",
    body: input
  });
}

export function sendAccountEmailCode(input: SendAccountEmailCodeInput) {
  return request<{ sent: boolean }>({
    method: "POST",
    path: "/api/account/email-code/send",
    body: input
  });
}

export function changeAccountEmail(input: ChangeAccountEmailInput) {
  return request<ChangeAccountEmailResponse>({
    method: "PATCH",
    path: "/api/account/email",
    body: input
  });
}

export function deleteAccount(input: DeleteAccountInput) {
  return request<void>({
    method: "DELETE",
    path: "/api/account",
    body: input,
    responseType: "void",
    skipAuthRefresh: true
  });
}

export function getMfaStatus() {
  return request<MfaStatusResponse>({
    path: "/api/auth/2fa/status"
  });
}

export function setupMfa(input: SetupMfaInput) {
  return request<SetupMfaResponse>({
    method: "POST",
    path: "/api/auth/2fa/setup",
    body: input
  });
}

export function confirmMfaSetup(input: ConfirmMfaSetupInput) {
  return request<MfaRecoveryCodesResponse>({
    method: "POST",
    path: "/api/auth/2fa/confirm",
    body: input
  });
}

export function disableMfa(input: VerifyMfaWithPasswordInput) {
  return request<void>({
    method: "POST",
    path: "/api/auth/2fa/disable",
    body: input,
    responseType: "void"
  });
}

export function regenerateMfaRecoveryCodes(input: VerifyMfaWithPasswordInput) {
  return request<MfaRecoveryCodesResponse>({
    method: "POST",
    path: "/api/auth/2fa/recovery-codes/regenerate",
    body: input
  });
}
