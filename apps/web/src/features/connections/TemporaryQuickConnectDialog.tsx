import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { getApiErrorMessage } from "../auth/api";
import { listCredentials } from "../credentials/api";
import type { Credential, CredentialAuthType } from "../credentials/types";
import { usePreferences } from "../preferences/PreferencesContext";
import { useToast } from "../ui/ToastContext";
import { Button, Dialog, FormField, SegmentedControl, SelectInput, TextareaInput, TextInput } from "../../shared/ui";
import { SensitiveInput, SensitiveTextarea } from "../../shared/ui/SensitiveFields";
import { getConnectionErrorMessage } from "./connectionErrorMessages";
import type { QuickConnectionKeyType, TemporaryConnectionInput } from "./types";

type QuickConnectTarget = "terminal" | "files";

type TemporaryQuickConnectForm = {
  host: string;
  port: string;
  username: string;
  authType: CredentialAuthType | "credential";
  credentialId: string;
  password: string;
  privateKey: string;
  passphrase: string;
  keyType: QuickConnectionKeyType;
};

type TemporaryQuickConnectDialogProps = {
  onConnectFiles: (input: TemporaryConnectionInput) => unknown | Promise<unknown>;
  onConnectTerminal: (input: TemporaryConnectionInput) => unknown | Promise<unknown>;
  onTestConnection: (input: TemporaryConnectionInput) => string | void | Promise<string | void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const defaultForm: TemporaryQuickConnectForm = {
  host: "",
  port: "22",
  username: "",
  authType: "password",
  credentialId: "",
  password: "",
  privateKey: "",
  passphrase: "",
  keyType: "auto"
};

function buildInput(form: TemporaryQuickConnectForm, credentials: Credential[]): TemporaryConnectionInput {
  const selectedCredential = credentials.find((credential) => credential.id === form.credentialId);
  const authType = form.authType === "credential" ? selectedCredential?.auth_type || "password" : form.authType;
  return {
    host: form.host.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    auth_type: authType,
    ...(form.authType === "credential" ? { credential_id: form.credentialId } : {}),
    ...(form.authType === "password" ? { password: form.password } : {}),
    ...(form.authType === "private_key"
      ? {
        private_key: form.privateKey,
        passphrase: form.passphrase || undefined,
        key_type: form.keyType
      }
      : {})
  };
}

export function TemporaryQuickConnectDialog({
  onConnectFiles,
  onConnectTerminal,
  onTestConnection,
  onOpenChange,
  open
}: TemporaryQuickConnectDialogProps) {
  const { t } = usePreferences();
  const toast = useToast();
  const formId = useId();
  const privateKeyFileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<TemporaryQuickConnectForm>(defaultForm);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submittingTarget, setSubmittingTarget] = useState<QuickConnectTarget | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const credentialOptions = useMemo(() => credentials, [credentials]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    const loadOptions = async () => {
      setLoadingOptions(true);
      setErrorMessage(null);
      try {
        const response = await listCredentials();
        if (mounted) {
          setCredentials(response.items);
        }
      } catch (error) {
        if (mounted) {
          setCredentials([]);
          const message = getApiErrorMessage(error, t("quickConnect.loadCredentialsFailed"), t);
          setErrorMessage(message);
          toast.error(message);
        }
      } finally {
        if (mounted) {
          setLoadingOptions(false);
        }
      }
    };

    void loadOptions();
    return () => {
      mounted = false;
    };
  }, [open, t, toast]);

  useEffect(() => {
    if (form.authType !== "credential") {
      return;
    }
    if (credentialOptions.some((credential) => credential.id === form.credentialId)) {
      return;
    }
    setForm((current) => ({ ...current, credentialId: credentialOptions[0]?.id || "" }));
  }, [credentialOptions, form.authType, form.credentialId]);

  const close = () => {
    if (submittingTarget || testingConnection) {
      return;
    }
    setForm(defaultForm);
    setErrorMessage(null);
    onOpenChange(false);
  };

  const validate = () => {
    const port = Number(form.port);
    if (!form.host.trim() || !form.username.trim()) {
      return t("quickConnect.validationHost");
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return t("quickConnect.validationPort");
    }
    if (form.authType === "password" && !form.password.trim()) {
      return t("quickConnect.validationPassword");
    }
    if (form.authType === "private_key" && !form.privateKey.trim()) {
      return t("quickConnect.validationPrivateKey");
    }
    if (form.authType === "credential" && !form.credentialId) {
      return t("quickConnect.validationCredential");
    }
    return null;
  };

  const submit = async (target: QuickConnectTarget) => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      toast.warning(validationError);
      return;
    }

    setSubmittingTarget(target);
    setErrorMessage(null);
    try {
      const input = buildInput(form, credentials);
      if (target === "terminal") {
        await onConnectTerminal(input);
      } else {
        await onConnectFiles(input);
      }
      setForm(defaultForm);
      onOpenChange(false);
    } catch (error) {
      const message = getConnectionErrorMessage(error, t("quickConnect.createFailed"), t);
      toast.error(message);
    } finally {
      setSubmittingTarget(null);
    }
  };

  const testConnection = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      toast.warning(validationError);
      return;
    }

    setTestingConnection(true);
    setErrorMessage(null);
    try {
      const message = await onTestConnection(buildInput(form, credentials));
      toast.success(message || t("quickConnect.testSuccess"));
    } catch (error) {
      const message = getConnectionErrorMessage(error, t("quickConnect.testFailed"), t);
      toast.error(message);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit("terminal");
  };

  const handlePrivateKeyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const privateKey = await file.text();
      setForm((current) => ({ ...current, privateKey }));
      toast.success(t("credential.privateKeyFileLoaded", { name: file.name }));
    } catch {
      toast.error(t("credential.privateKeyFileFailed"));
    }
  };

  return (
    <Dialog
      closeLabel={t("common.close")}
      description={<span>{t("quickConnect.temporaryCopy")}</span>}
      footer={
        <>
          <Button disabled={Boolean(submittingTarget) || testingConnection} onClick={close} variant="secondary">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={Boolean(submittingTarget) || testingConnection || loadingOptions}
            onClick={() => void testConnection()}
            type="button"
            variant="secondary"
          >
            {testingConnection ? t("quickConnect.testingConnection") : t("quickConnect.testConnection")}
          </Button>
          <Button disabled={Boolean(submittingTarget) || testingConnection || loadingOptions} form={formId} type="submit" variant="primary">
            {submittingTarget === "terminal" ? t("quickConnect.connecting") : t("quickConnect.connectTerminal")}
          </Button>
          <Button
            disabled={Boolean(submittingTarget) || testingConnection || loadingOptions}
            onClick={() => void submit("files")}
            type="button"
            variant="secondary"
          >
            {submittingTarget === "files" ? t("quickConnect.connecting") : t("quickConnect.connectFiles")}
          </Button>
        </>
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        } else {
          onOpenChange(true);
        }
      }}
      open={open}
      size="lg"
      title={t("quickConnect.quickConnect")}
    >
      <form className="quick-connect-form" id={formId} onSubmit={handleSubmit}>
        {loadingOptions ? (
          <div className="inline-note">
            <p>{t("quickConnect.loadingCredentials")}</p>
          </div>
        ) : null}
        {errorMessage ? (
          <div className="inline-note inline-note-danger">
            <p>{errorMessage}</p>
          </div>
        ) : null}

        <div className="quick-connect-grid quick-connect-grid-basic">
          <FormField label={t("host.address")}>
            {(id) => (
              <TextInput
                autoComplete="off"
                id={id}
                onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                placeholder="203.0.113.10"
                required
                value={form.host}
              />
            )}
          </FormField>

          <FormField label={t("host.port")}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                max={65535}
                min={1}
                onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
                required
                type="number"
                value={form.port}
              />
            )}
          </FormField>

          <FormField label={t("host.username")}>
            {(id) => (
              <TextInput
                autoComplete="username"
                id={id}
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                required
                value={form.username}
              />
            )}
          </FormField>
        </div>

        <section className="quick-connect-section">
          <div className="quick-connect-section-header">
            <strong>{t("credential.authType")}</strong>
            <SegmentedControl
              ariaLabel={t("credential.authType")}
              items={[
                { label: t("credential.password"), value: "password" },
                { label: t("credential.privateKey"), value: "private_key" },
                { label: t("quickConnect.credentialConnect"), value: "credential" }
              ]}
              onChange={(value) => setForm((current) => ({
                ...current,
                authType: value as TemporaryQuickConnectForm["authType"],
                credentialId: value === "credential" ? credentialOptions[0]?.id || "" : ""
              }))}
              value={form.authType}
            />
          </div>

          {form.authType === "password" ? (
            <FormField label={t("credential.sshPassword")}>
              {(id) => (
                <SensitiveInput
                  autoComplete="new-password"
                  className="ui-input"
                  id={id}
                  label={t("auth.reveal")}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  value={form.password}
                />
              )}
            </FormField>
          ) : null}

          {form.authType === "private_key" ? (
            <div className="quick-connect-grid quick-connect-grid-secret">
              <input
                accept=".pem,.key,.pub,.txt"
                aria-hidden="true"
                className="visually-hidden"
                onChange={handlePrivateKeyFile}
                ref={privateKeyFileRef}
                tabIndex={-1}
                type="file"
              />
              <div className="quick-connect-upload-row">
                <Button onClick={() => privateKeyFileRef.current?.click()} type="button" variant="secondary">
                  {t("credential.uploadPrivateKey")}
                </Button>
              </div>
              <FormField label={t("quickConnect.keyType")}>
                {(id) => (
                  <SelectInput
                    className="quick-connect-select"
                    id={id}
                    onChange={(event) => setForm((current) => ({ ...current, keyType: event.target.value as QuickConnectionKeyType }))}
                    value={form.keyType}
                  >
                    <option value="auto">{t("quickConnect.keyTypeAuto")}</option>
                    <option value="rsa">{t("credential.keyPairTypeRsa")}</option>
                    <option value="ed25519">{t("credential.keyPairTypeEd25519")}</option>
                    <option value="ecdsa">{t("credential.keyPairTypeEcdsa")}</option>
                  </SelectInput>
                )}
              </FormField>
              <FormField label={t("credential.privateKeyContent")}>
                {(id) => (
                  <SensitiveTextarea
                    className="quick-connect-private-key"
                    id={id}
                    label={t("auth.reveal")}
                    onChange={(event) => setForm((current) => ({ ...current, privateKey: event.target.value }))}
                    placeholder={t("credential.privateKeyPlaceholder")}
                    required
                    rows={6}
                    value={form.privateKey}
                  />
                )}
              </FormField>
              <FormField label={t("credential.passphraseOptional")}>
                {(id) => (
                  <SensitiveInput
                    autoComplete="new-password"
                    className="ui-input"
                    id={id}
                    label={t("auth.reveal")}
                    onChange={(event) => setForm((current) => ({ ...current, passphrase: event.target.value }))}
                    value={form.passphrase}
                  />
                )}
              </FormField>
            </div>
          ) : null}

          {form.authType === "credential" ? (
            <FormField
              description={credentialOptions.length === 0 ? t("quickConnect.noCredential") : undefined}
              label={t("host.bindCredential")}
            >
              {(id) => (
                <SelectInput
                  className="quick-connect-select"
                  disabled={credentialOptions.length === 0}
                  id={id}
                  onChange={(event) => setForm((current) => ({ ...current, credentialId: event.target.value }))}
                  required
                  value={form.credentialId}
                >
                  {credentialOptions.map((credential) => (
                    <option key={credential.id} value={credential.id}>{credential.name}</option>
                  ))}
                </SelectInput>
              )}
            </FormField>
          ) : null}
        </section>

        <div className="inline-note">
          <p>{t("quickConnect.temporaryNote")}</p>
        </div>
      </form>
    </Dialog>
  );
}
