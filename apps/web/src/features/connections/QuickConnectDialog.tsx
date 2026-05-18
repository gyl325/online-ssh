import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { getApiErrorMessage } from "../auth/api";
import { listCredentials } from "../credentials/api";
import type { Credential } from "../credentials/types";
import { listHostGroups } from "../hosts/api";
import type { Host, HostAuthType, HostGroup } from "../hosts/types";
import { usePreferences } from "../preferences/PreferencesContext";
import { useToast } from "../ui/ToastContext";
import { Button, Dialog, FormField, SegmentedControl, SelectInput, TextInput } from "../../shared/ui";
import { SensitiveInput, SensitiveTextarea } from "../../shared/ui/SensitiveFields";
import { quickConnect } from "./api";
import { getConnectionErrorMessage } from "./connectionErrorMessages";

type CredentialMode = "new" | "existing";

type QuickConnectForm = {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: HostAuthType;
  credentialMode: CredentialMode;
  credentialId: string;
  credentialName: string;
  password: string;
  privateKey: string;
  passphrase: string;
  groupId: string;
  isFavorite: boolean;
};

type QuickConnectDialogProps = {
  onConnected: (host: Host) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const defaultForm: QuickConnectForm = {
  name: "",
  host: "",
  port: "22",
  username: "",
  authType: "password",
  credentialMode: "new",
  credentialId: "",
  credentialName: "",
  password: "",
  privateKey: "",
  passphrase: "",
  groupId: "",
  isFavorite: false
};

function buildConnectionName(form: QuickConnectForm) {
  const explicitName = form.name.trim();
  if (explicitName) {
    return explicitName;
  }

  const username = form.username.trim();
  const host = form.host.trim();
  if (username && host) {
    return `${username}@${host}`;
  }
  return host || username;
}

export function QuickConnectDialog({ onConnected, onOpenChange, open }: QuickConnectDialogProps) {
  const { t } = usePreferences();
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState<QuickConnectForm>(defaultForm);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [hostGroups, setHostGroups] = useState<HostGroup[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matchingCredentials = useMemo(
    () => credentials.filter((credential) => credential.auth_type === form.authType),
    [credentials, form.authType]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    const loadOptions = async () => {
      setLoadingOptions(true);
      setErrorMessage(null);
      try {
        const [credentialResponse, groupResponse] = await Promise.all([
          listCredentials(),
          listHostGroups()
        ]);
        if (mounted) {
          setCredentials(credentialResponse.items);
          setHostGroups(groupResponse.items);
        }
      } catch (error) {
        if (mounted) {
          setCredentials([]);
          setHostGroups([]);
          const message = getApiErrorMessage(error, t("quickConnect.loadOptionsFailed"), t);
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
  }, [open, t]);

  useEffect(() => {
    if (form.credentialMode !== "existing") {
      return;
    }
    if (matchingCredentials.some((credential) => credential.id === form.credentialId)) {
      return;
    }
    setForm((current) => ({
      ...current,
      credentialId: matchingCredentials[0]?.id || "",
      credentialMode: matchingCredentials.length > 0 ? "existing" : "new"
    }));
  }, [form.authType, form.credentialId, form.credentialMode, matchingCredentials]);

  const close = () => {
    if (submitting) {
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
    if (form.credentialMode === "existing" && !form.credentialId) {
      return t("quickConnect.validationCredential");
    }
    if (form.credentialMode === "new" && form.authType === "password" && !form.password.trim()) {
      return t("quickConnect.validationPassword");
    }
    if (form.credentialMode === "new" && form.authType === "private_key" && !form.privateKey.trim()) {
      return t("quickConnect.validationPrivateKey");
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      toast.warning(validationError);
      return;
    }

    const name = buildConnectionName(form);
    const port = Number(form.port);
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await quickConnect({
        name,
        host: form.host.trim(),
        port,
        username: form.username.trim(),
        auth_type: form.authType,
        ...(form.credentialMode === "existing" ? { credential_id: form.credentialId } : {}),
        ...(form.credentialMode === "new"
          ? { credential_name: form.credentialName.trim() || t("quickConnect.defaultCredentialName", { name }) }
          : {}),
        ...(form.credentialMode === "new" && form.authType === "password"
          ? { password: form.password }
          : {}),
        ...(form.credentialMode === "new" && form.authType === "private_key"
          ? {
            private_key: form.privateKey,
            passphrase: form.passphrase || undefined
          }
          : {}),
        group_id: form.groupId || null,
        is_favorite: form.isFavorite
      });

      setForm(defaultForm);
      onOpenChange(false);
      await onConnected(response.host);
    } catch (error) {
      const message = getConnectionErrorMessage(error, t("quickConnect.createFailed"), t);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      closeLabel={t("common.close")}
      description={<span>{t("quickConnect.copy")}</span>}
      footer={
        <>
          <Button disabled={submitting} onClick={close} variant="secondary">
            {t("common.cancel")}
          </Button>
          <Button disabled={submitting || loadingOptions} form={formId} type="submit" variant="primary">
            {submitting ? t("quickConnect.submitting") : t("quickConnect.submit")}
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
      title={t("quickConnect.title")}
    >
      <form className="quick-connect-form" id={formId} onSubmit={handleSubmit}>
        {loadingOptions ? (
          <div className="inline-note">
            <p>{t("quickConnect.loadingOptions")}</p>
          </div>
        ) : null}
        <div className="quick-connect-grid">
          <FormField description={t("quickConnect.nameDescription")} label={t("quickConnect.name")}>
            {(id) => (
              <TextInput
                id={id}
                maxLength={120}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={t("quickConnect.namePlaceholder")}
                value={form.name}
              />
            )}
          </FormField>

          <FormField label={t("host.group")}>
            {(id) => (
              <SelectInput
                className="quick-connect-select"
                id={id}
                onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
                value={form.groupId}
              >
                <option value="">{t("host.ungrouped")}</option>
                {hostGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </SelectInput>
            )}
          </FormField>

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

          <label className="toggle-row quick-connect-favorite">
            <input
              checked={form.isFavorite}
              onChange={(event) => setForm((current) => ({ ...current, isFavorite: event.target.checked }))}
              type="checkbox"
            />
            <span>{t("host.addFavorite")}</span>
          </label>
        </div>

        <section className="quick-connect-section">
          <div className="quick-connect-section-header">
            <strong>{t("credential.authType")}</strong>
            <SegmentedControl
              ariaLabel={t("credential.authType")}
              items={[
                { label: t("credential.password"), value: "password" },
                { label: t("credential.privateKey"), value: "private_key" }
              ]}
              onChange={(value) => setForm((current) => ({
                ...current,
                authType: value as HostAuthType,
                credentialId: "",
                credentialMode: "new"
              }))}
              value={form.authType}
            />
          </div>

          <div className="quick-connect-section-header">
            <strong>{t("quickConnect.credentialSource")}</strong>
            <SegmentedControl
              ariaLabel={t("quickConnect.credentialSource")}
              items={[
                { label: t("quickConnect.newCredential"), value: "new" },
                { label: t("quickConnect.existingCredential"), value: "existing" }
              ]}
              onChange={(value) => setForm((current) => ({
                ...current,
                credentialMode: value as CredentialMode,
                credentialId: value === "existing" ? matchingCredentials[0]?.id || "" : ""
              }))}
              value={form.credentialMode}
            />
          </div>

          {form.credentialMode === "existing" ? (
            <FormField
              description={matchingCredentials.length === 0 ? t("quickConnect.noMatchingCredential") : undefined}
              label={t("host.bindCredential")}
            >
              {(id) => (
                <SelectInput
                  className="quick-connect-select"
                  disabled={matchingCredentials.length === 0}
                  id={id}
                  onChange={(event) => setForm((current) => ({ ...current, credentialId: event.target.value }))}
                  required
                  value={form.credentialId}
                >
                  {matchingCredentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>{credential.name}</option>
                  ))}
                </SelectInput>
              )}
            </FormField>
          ) : (
            <div className="quick-connect-grid quick-connect-grid-secret">
              <FormField description={t("quickConnect.credentialNameDescription")} label={t("quickConnect.credentialName")}>
                {(id) => (
                  <TextInput
                    id={id}
                    maxLength={120}
                    onChange={(event) => setForm((current) => ({ ...current, credentialName: event.target.value }))}
                    placeholder={t("quickConnect.credentialNamePlaceholder")}
                    value={form.credentialName}
                  />
                )}
              </FormField>

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
              ) : (
                <>
                  <FormField label={t("credential.privateKeyContent")}>
                    {(id) => (
                      <SensitiveTextarea
                        className="quick-connect-private-key"
                        id={id}
                        label={t("auth.reveal")}
                        onChange={(event) => setForm((current) => ({ ...current, privateKey: event.target.value }))}
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
                </>
              )}
            </div>
          )}
        </section>

        <div className="inline-note">
          <p>{t("quickConnect.note1")}</p>
          <p>{t("quickConnect.note2")}</p>
        </div>
      </form>
    </Dialog>
  );
}
