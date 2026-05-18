import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Info, KeyRound, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";

import { getApiErrorMessage } from "../features/auth/api";
import {
  createCredential,
  deleteCredential,
  generateCredentialKeyPair,
  getCredential,
  listCredentials,
  updateCredential
} from "../features/credentials/api";
import type {
  CreateCredentialInput,
  Credential,
  CredentialAuthType,
  CredentialKeyPairAlgorithm,
  GeneratedCredentialKeyPair,
  UpdateCredentialInput
} from "../features/credentials/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import { useToast } from "../features/ui/ToastContext";
import { copyTextToClipboard } from "../shared/lib/clipboard";
import { formatDateTime } from "../shared/lib/date";
import {
  Button,
  Card,
  DetailDialog,
  Dialog,
  EmptyState,
  FilterChip,
  FormField,
  IconButton,
  InlineNote,
  LoadingState,
  SelectInput,
  TextInput,
  ToggleRow
} from "../shared/ui";
import { SensitiveInput, SensitiveTextarea } from "../shared/ui/SensitiveFields";

type EditorMode = "create" | "view" | "edit";

type CreateFormState = {
  name: string;
  authType: CredentialAuthType;
  password: string;
  privateKey: string;
  passphrase: string;
  keyPairAlgorithm: CredentialKeyPairAlgorithm;
  deployUser: string;
};

type EditFormState = {
  name: string;
  password: string;
  privateKey: string;
  passphrase: string;
  keyPairAlgorithm: CredentialKeyPairAlgorithm;
  deployUser: string;
  updatePassword: boolean;
  updatePrivateKey: boolean;
  updatePassphrase: boolean;
  clearPassphrase: boolean;
};

const defaultCreateForm = (): CreateFormState => ({
  name: "",
  authType: "password",
  password: "",
  privateKey: "",
  passphrase: "",
  keyPairAlgorithm: "ed25519",
  deployUser: ""
});

const defaultEditForm = (credential?: Credential | null): EditFormState => ({
  name: credential?.name || "",
  password: "",
  privateKey: "",
  passphrase: "",
  keyPairAlgorithm: "ed25519",
  deployUser: "",
  updatePassword: false,
  updatePrivateKey: false,
  updatePassphrase: false,
  clearPassphrase: false
});

function authTypeLabel(value: CredentialAuthType, t: (key: string) => string) {
  return value === "password" ? t("credential.password") : t("credential.privateKey");
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildDeployCommand(authorizedKeyLine: string) {
  if (!authorizedKeyLine) {
    return "";
  }
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${shellSingleQuote(authorizedKeyLine)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

function appendAuthorizedKeyComment(authorizedKeyLine: string, comment: string) {
  const normalizedComment = comment.trim().replace(/\s+/g, "_");
  if (!authorizedKeyLine || !normalizedComment) {
    return authorizedKeyLine;
  }
  const parts = authorizedKeyLine.trim().split(/\s+/);
  if (parts.length < 2) {
    return authorizedKeyLine;
  }
  return `${parts[0]} ${parts[1]} ${normalizedComment}`;
}

export async function writeCredentialClipboardText(value: string) {
  return copyTextToClipboard(value);
}

export function CredentialsPage() {
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const { language, t } = usePreferences();
  const [items, setItems] = useState<Credential[]>([]);
  const [filter, setFilter] = useState<"all" | CredentialAuthType>("all");
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modalMode, setModalMode] = useState<EditorMode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCredential, setActiveCredential] = useState<Credential | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(defaultCreateForm);
  const [editForm, setEditForm] = useState<EditFormState>(defaultEditForm);
  const [submitting, setSubmitting] = useState(false);
  const [keyPairState, setKeyPairState] = useState<"idle" | "generating">("idle");
  const [generatedKeyPair, setGeneratedKeyPair] = useState<GeneratedCredentialKeyPair | null>(null);
  const privateKeyFileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleItems = useMemo(() => {
    if (filter === "all") {
      return items;
    }
    return items.filter((item) => item.auth_type === filter);
  }, [filter, items]);

  const filterLabel = useMemo(() => {
    switch (filter) {
      case "password":
        return t("credential.passwordCredential");
      case "private_key":
        return t("credential.privateKeyCredential");
      default:
        return t("credential.allCredentials");
    }
  }, [filter, t]);

  const deploymentAuthorizedKeyLine = useMemo(() => {
    const deployUser = modalMode === "edit" ? editForm.deployUser : createForm.deployUser;
    return appendAuthorizedKeyComment(generatedKeyPair?.authorized_key_line || "", deployUser);
  }, [createForm.deployUser, editForm.deployUser, generatedKeyPair?.authorized_key_line, modalMode]);
  const deploymentCommand = useMemo(() => buildDeployCommand(deploymentAuthorizedKeyLine), [deploymentAuthorizedKeyLine]);

  const closeModal = () => {
    setModalMode(null);
    setActiveId(null);
    setActiveCredential(null);
    setDetailState("idle");
    setFormError(null);
    setCreateForm(defaultCreateForm());
    setEditForm(defaultEditForm());
    setGeneratedKeyPair(null);
    setKeyPairState("idle");
  };

  const loadList = async () => {
    setListState("loading");
    setListError(null);

    try {
      const response = await listCredentials();
      setItems(response.items);
      setListState("ready");
    } catch (error) {
      setItems([]);
      setListState("error");
      const message = getApiErrorMessage(error, t("credential.listFailed"), t);
      setListError(message);
      toast.error(message);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (!activeId || modalMode === "create") {
      return;
    }

    let disposed = false;

    const loadDetail = async () => {
      setDetailState("loading");
      setFormError(null);

      try {
        const response = await getCredential(activeId);
        if (disposed) {
          return;
        }

        setActiveCredential(response.credential);
        setEditForm(defaultEditForm(response.credential));
        setDetailState("ready");
      } catch (error) {
        if (disposed) {
          return;
        }

        setActiveCredential(null);
        setDetailState("error");
        const message = getApiErrorMessage(error, t("credential.detailFailed"), t);
        setFormError(message);
        toast.error(message);
      }
    };

    void loadDetail();

    return () => {
      disposed = true;
    };
  }, [activeId, modalMode]);

  const beginCreate = () => {
    setPageMessage(null);
    setFormError(null);
    setCreateForm(defaultCreateForm());
    setGeneratedKeyPair(null);
    setKeyPairState("idle");
    setModalMode("create");
    setActiveId(null);
    setActiveCredential(null);
  };

  const openCredential = (credential: Credential, mode: EditorMode) => {
    setPageMessage(null);
    setFormError(null);
    setActiveCredential(credential);
    setEditForm(defaultEditForm(credential));
    setActiveId(credential.id);
    setModalMode(mode);
  };

  const handleCreateSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    const payload: CreateCredentialInput = {
      name: createForm.name.trim(),
      auth_type: createForm.authType
    };

    if (createForm.authType === "password") {
      payload.password = createForm.password;
    } else {
      payload.private_key = createForm.privateKey;
      if (createForm.passphrase.trim()) {
        payload.passphrase = createForm.passphrase;
      }
    }

    try {
      await createCredential(payload);
      const message = t("credential.created");
      setPageMessage(message);
      toast.success(message);
      closeModal();
      await loadList();
    } catch (error) {
      const message = getApiErrorMessage(error, t("credential.createFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeCredential) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    const payload: UpdateCredentialInput = {
      name: editForm.name.trim()
    };

    if (activeCredential.auth_type === "password" && editForm.updatePassword) {
      payload.password = editForm.password;
    }

    if (activeCredential.auth_type === "private_key") {
      if (editForm.updatePrivateKey) {
        payload.private_key = editForm.privateKey;
      }

      if (editForm.clearPassphrase) {
        payload.passphrase = "";
      } else if (editForm.updatePassphrase) {
        payload.passphrase = editForm.passphrase;
      }
    }

    try {
      await updateCredential(activeCredential.id, payload);
      const message = t("credential.updated");
      setPageMessage(message);
      toast.success(message);
      closeModal();
      await loadList();
    } catch (error) {
      const message = getApiErrorMessage(error, t("credential.updateFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCredential = async (credential: Credential) => {
    const shouldDelete = await confirmDialog.requestConfirmation({
      title: t("credential.deleteTitle"),
      message: t("credential.deleteMessage", { name: credential.name }),
      confirmLabel: t("credential.confirmDelete"),
      tone: "danger"
    });
    if (!shouldDelete) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setPageMessage(null);

    try {
      await deleteCredential(credential.id);
      const message = t("credential.deleted");
      setPageMessage(message);
      toast.success(message);
      closeModal();
      await loadList();
    } catch (error) {
      const message = getApiErrorMessage(error, t("credential.deleteFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrivateKeyFileSelected = async (mode: "create" | "edit", event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      if (mode === "create") {
        setCreateForm((current) => ({ ...current, privateKey: content }));
      } else {
        setEditForm((current) => ({
          ...current,
          privateKey: content,
          updatePrivateKey: true
        }));
      }
      setGeneratedKeyPair(null);
      toast.success(t("credential.privateKeyFileLoaded", { name: file.name }));
    } catch {
      const message = t("credential.privateKeyFileFailed");
      setFormError(message);
      toast.error(message);
    }
  };

  const handleGenerateKeyPair = async (mode: "create" | "edit") => {
    const algorithm = mode === "create" ? createForm.keyPairAlgorithm : editForm.keyPairAlgorithm;
    const deployUser = mode === "create" ? createForm.deployUser : editForm.deployUser;
    setKeyPairState("generating");
    setFormError(null);
    setGeneratedKeyPair(null);

    try {
      const response = await generateCredentialKeyPair({
        algorithm,
        comment: deployUser || undefined
      });
      setGeneratedKeyPair(response.key_pair);
      if (mode === "create") {
        setCreateForm((current) => ({
          ...current,
          privateKey: response.key_pair.private_key,
          keyPairAlgorithm: response.key_pair.algorithm
        }));
      } else {
        setEditForm((current) => ({
          ...current,
          privateKey: response.key_pair.private_key,
          keyPairAlgorithm: response.key_pair.algorithm,
          updatePrivateKey: true
        }));
      }
      toast.success(t("credential.keyPairGenerated"));
    } catch (error) {
      const message = getApiErrorMessage(error, t("credential.keyPairGenerateFailed"), t);
      setFormError(message);
      toast.error(message);
    } finally {
      setKeyPairState("idle");
    }
  };

  const copyDeploymentCommand = async () => {
    if (!deploymentCommand) {
      return;
    }
    try {
      const copied = await writeCredentialClipboardText(deploymentCommand);
      if (!copied) {
        toast.error(t("credential.deployCommandCopyFailed"));
        return;
      }
      toast.success(t("credential.deployCommandCopied"));
    } catch {
      toast.error(t("credential.deployCommandCopyFailed"));
    }
  };

  const renderPrivateKeyMaterialControls = (mode: "create" | "edit") => {
    const isCreate = mode === "create";
    const form = isCreate ? createForm : editForm;
    const privateKeyLabel = isCreate ? t("credential.privateKeyContent") : t("credential.newPrivateKey");

    return (
      <>
        <section className="credential-keygen-panel" aria-label={t("credential.keyPairGenerator")}>
          <div className="credential-keygen-header">
            <div>
              <strong>{t("credential.keyPairGenerator")}</strong>
              <p>{t("credential.keyPairGeneratorCopy")}</p>
            </div>
            <Button
              disabled={keyPairState === "generating"}
              leadingIcon={<KeyRound aria-hidden="true" />}
              onClick={() => void handleGenerateKeyPair(mode)}
              variant="secondary"
            >
              {keyPairState === "generating" ? t("credential.generatingKeyPair") : t("credential.generateKeyPair")}
            </Button>
          </div>
          <div className="credential-keygen-grid">
            <FormField label={t("credential.keyPairType")}>
              {(id) => (
                <SelectInput
                  id={id}
                  onChange={(event) => {
                    const keyPairAlgorithm = event.target.value as CredentialKeyPairAlgorithm;
                    if (isCreate) {
                      setCreateForm((current) => ({ ...current, keyPairAlgorithm }));
                    } else {
                      setEditForm((current) => ({ ...current, keyPairAlgorithm }));
                    }
                  }}
                  value={form.keyPairAlgorithm}
                >
                  <option value="ed25519">{t("credential.keyPairTypeEd25519")}</option>
                  <option value="ecdsa">{t("credential.keyPairTypeEcdsa")}</option>
                  <option value="rsa">{t("credential.keyPairTypeRsa")}</option>
                </SelectInput>
              )}
            </FormField>
            <FormField
              description={t("credential.deployUserDescription")}
              label={t("credential.deployUser")}
            >
              {(id) => (
                <TextInput
                  id={id}
                  onChange={(event) => {
                    const deployUser = event.target.value;
                    if (isCreate) {
                      setCreateForm((current) => ({ ...current, deployUser }));
                    } else {
                      setEditForm((current) => ({ ...current, deployUser }));
                    }
                  }}
                  placeholder={t("credential.deployUserPlaceholder")}
                  value={form.deployUser}
                />
              )}
            </FormField>
          </div>
          {generatedKeyPair ? (
            <div className="credential-deploy-command">
              <div className="credential-deploy-command-header">
                <strong>{t("credential.deployCommand")}</strong>
                <Button
                  leadingIcon={<Copy aria-hidden="true" />}
                  onClick={() => void copyDeploymentCommand()}
                  size="sm"
                  variant="secondary"
                >
                  {t("credential.copyDeployCommand")}
                </Button>
              </div>
              <code>{deploymentCommand}</code>
            </div>
          ) : null}
        </section>

        <div className="credential-key-actions">
          <input
            accept=".pem,.key,.txt,.pub"
            aria-label={t("credential.uploadPrivateKey")}
            className="visually-hidden"
            onChange={(event) => void handlePrivateKeyFileSelected(mode, event)}
            ref={privateKeyFileInputRef}
            type="file"
          />
          <Button
            leadingIcon={<Upload aria-hidden="true" />}
            onClick={() => privateKeyFileInputRef.current?.click()}
            variant="secondary"
          >
            {t("credential.uploadPrivateKey")}
          </Button>
        </div>

        <FormField label={privateKeyLabel}>
          {(id) => (
            <SensitiveTextarea
              className="ui-textarea"
              id={id}
              label={t("auth.reveal")}
              onChange={(event) => {
                const privateKey = event.target.value;
                if (isCreate) {
                  setCreateForm((current) => ({ ...current, privateKey }));
                } else {
                  setEditForm((current) => ({ ...current, privateKey, updatePrivateKey: true }));
                }
              }}
              placeholder={t("credential.privateKeyPlaceholder")}
              required
              rows={8}
              value={form.privateKey}
            />
          )}
        </FormField>
      </>
    );
  };

  return (
    <div className="route-page credentials-page">
      <p className="eyebrow route-eyebrow">Credential Vault</p>

      <section className="content-card resource-panel">
        <div className="section-header">
          <div>
            <h4>{t("credential.listTitle")}</h4>
            <p>{filterLabel} · {visibleItems.length} / {items.length}</p>
          </div>
          <div className="resource-toolbar">
            <IconButton label={t("credential.new")} onClick={beginCreate}>
              <Plus aria-hidden="true" />
            </IconButton>
            <IconButton label={t("credential.refresh")} onClick={() => void loadList()}>
              <RefreshCw aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="filter-row">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            {t("credential.filterAll")}
          </FilterChip>
          <FilterChip active={filter === "password"} onClick={() => setFilter("password")}>
            {t("credential.filterPassword")}
          </FilterChip>
          <FilterChip active={filter === "private_key"} onClick={() => setFilter("private_key")}>
            {t("credential.filterPrivateKey")}
          </FilterChip>
        </div>

        <div className={listState === "loading" ? "resource-card-area resource-card-area-loading" : "resource-card-area"}>
          {listState === "loading" ? (
            <div className="loading-overlay">
              <LoadingState label={t("credential.loading")} />
            </div>
          ) : null}

          {listState === "ready" && visibleItems.length === 0 ? (
            <EmptyState description={t("credential.empty2")} title={t("credential.empty1")} />
          ) : null}

          <div className="resource-card-grid">
            {visibleItems.map((item) => (
              <Card aria-label={item.name} className="resource-card" density="sm" key={item.id}>
                <div className="resource-card-main">
                  <div className="credential-item-top">
                    <strong>{item.name}</strong>
                    <span className="tag">{authTypeLabel(item.auth_type, t)}</span>
                  </div>
                  <div className="credential-meta">
                    <span>Key v{item.key_version}</span>
                    <span>{formatDateTime(item.updated_at, language, item.updated_at)}</span>
                  </div>
                </div>
                <div className="resource-card-actions">
                  <IconButton
                    className="ui-action-icon"
                    label={t("common.viewDetails")}
                    onClick={(event) => {
                      event.stopPropagation();
                      openCredential(item, "view");
                    }}
                  >
                    <Info aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    className="ui-action-icon"
                    label={t("credential.editTitle")}
                    onClick={(event) => {
                      event.stopPropagation();
                      openCredential(item, "edit");
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    className="ui-action-icon ui-action-icon-danger"
                    label={t("credential.deleteTitle")}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteCredential(item);
                    }}
                    variant="danger"
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {modalMode === "view" ? (
        <DetailDialog
          closeLabel={t("common.close")}
          items={activeCredential ? [
            { label: t("common.name"), value: activeCredential.name },
            { label: t("credential.authType"), value: authTypeLabel(activeCredential.auth_type, t) },
            { label: t("credential.passwordSaved"), value: activeCredential.has_secret ? t("common.yes") : t("common.no") },
            { label: t("credential.privateKeySaved"), value: activeCredential.has_private_key ? t("common.yes") : t("common.no") },
            { label: t("credential.passphraseSaved"), value: activeCredential.has_passphrase ? t("common.yes") : t("common.no") },
            { label: "Key Version", value: activeCredential.key_version },
            { label: t("credential.createdAt"), value: formatDateTime(activeCredential.created_at, language, activeCredential.created_at) },
            { label: t("credential.updatedAt"), value: formatDateTime(activeCredential.updated_at, language, activeCredential.updated_at) }
          ] : []}
          leadingContent={(
            <>
              {detailState === "loading" && !activeCredential ? <p>{t("credential.loadingDetail")}</p> : null}
            </>
          )}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open
          size="md"
          title={t("credential.detailTitle")}
        >
          {activeCredential ? (
            <div className="editor-actions">
              <Button onClick={() => setModalMode("edit")} variant="secondary">{t("credential.edit")}</Button>
              <Button onClick={() => void handleDeleteCredential(activeCredential)} variant="danger">{t("credential.delete")}</Button>
            </div>
          ) : null}
        </DetailDialog>
      ) : null}

      {modalMode && modalMode !== "view" ? (
        <Dialog
          closeLabel={t("common.close")}
          onOpenChange={(open) => {
            if (!open) {
              closeModal();
            }
          }}
          open
          size="lg"
          title={modalMode === "create" ? t("credential.createTitle") : modalMode === "edit" ? t("credential.editTitle") : t("credential.detailTitle")}
        >
          {detailState === "loading" && modalMode !== "create" && !activeCredential ? <p>{t("credential.loadingDetail")}</p> : null}

          {modalMode === "create" ? (
            <form className="auth-form" onSubmit={handleCreateSubmit}>
              <FormField label={t("common.name")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    type="text"
                    value={createForm.name}
                  />
                )}
              </FormField>

              <div className="filter-row">
                <FilterChip active={createForm.authType === "password"} onClick={() => setCreateForm((current) => ({ ...current, authType: "password" }))}>
                  {t("credential.passwordAuth")}
                </FilterChip>
                <FilterChip active={createForm.authType === "private_key"} onClick={() => setCreateForm((current) => ({ ...current, authType: "private_key" }))}>
                  {t("credential.privateKeyAuth")}
                </FilterChip>
              </div>

              {createForm.authType === "password" ? (
                <FormField label={t("credential.sshPassword")}>
                  {(id) => (
                    <SensitiveInput
                      autoComplete="new-password"
                      className="ui-input"
                      id={id}
                      label={t("auth.reveal")}
                      onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
                      required
                      value={createForm.password}
                    />
                  )}
                </FormField>
              ) : (
                <>
                  {renderPrivateKeyMaterialControls("create")}

                  <FormField label={t("credential.passphraseOptional")}>
                    {(id) => (
                      <SensitiveInput
                        autoComplete="new-password"
                        className="ui-input"
                        id={id}
                        label={t("auth.reveal")}
                        onChange={(event) => setCreateForm((current) => ({ ...current, passphrase: event.target.value }))}
                        value={createForm.passphrase}
                      />
                    )}
                  </FormField>
                </>
              )}

              <InlineNote>{t("credential.secretNote")}</InlineNote>

              <div className="editor-actions">
                <Button onClick={closeModal} variant="secondary">{t("common.cancel")}</Button>
                <Button disabled={submitting} type="submit" variant="primary">
                  {submitting ? t("credential.creating") : t("credential.create")}
                </Button>
              </div>
            </form>
          ) : null}

          {modalMode === "edit" && activeCredential ? (
            <form className="auth-form" onSubmit={handleUpdateSubmit}>
              <FormField label={t("common.name")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                    required
                    type="text"
                    value={editForm.name}
                  />
                )}
              </FormField>

              {activeCredential.auth_type === "password" ? (
                <>
                  <ToggleRow
                    checked={editForm.updatePassword}
                    label={t("credential.reenterPassword")}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        updatePassword: event.target.checked,
                        password: event.target.checked ? current.password : ""
                      }))
                    }
                  />
                  {editForm.updatePassword ? (
                    <FormField label={t("credential.newPassword")}>
                      {(id) => (
                        <SensitiveInput
                          autoComplete="new-password"
                          className="ui-input"
                          id={id}
                          label={t("auth.reveal")}
                          onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))}
                          required
                          value={editForm.password}
                        />
                      )}
                    </FormField>
                  ) : null}
                </>
              ) : (
                <>
                  <ToggleRow
                    checked={editForm.updatePrivateKey}
                    label={t("credential.reenterPrivateKey")}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        updatePrivateKey: event.target.checked,
                        privateKey: event.target.checked ? current.privateKey : ""
                      }))
                    }
                  />
                  {editForm.updatePrivateKey ? (
                    renderPrivateKeyMaterialControls("edit")
                  ) : null}

                  <ToggleRow
                    checked={editForm.updatePassphrase}
                    label={t("credential.updatePassphrase")}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        updatePassphrase: event.target.checked,
                        clearPassphrase: event.target.checked ? current.clearPassphrase : false,
                        passphrase: event.target.checked ? current.passphrase : ""
                      }))
                    }
                  />
                  {editForm.updatePassphrase ? (
                    <>
                      <FormField label={t("credential.newPassphrase")}>
                        {(id) => (
                          <SensitiveInput
                            autoComplete="new-password"
                            className="ui-input"
                            disabled={editForm.clearPassphrase}
                            id={id}
                            label={t("auth.reveal")}
                            onChange={(event) => setEditForm((current) => ({ ...current, passphrase: event.target.value }))}
                            value={editForm.passphrase}
                          />
                        )}
                      </FormField>
                      <ToggleRow
                        checked={editForm.clearPassphrase}
                        label={t("credential.clearPassphrase")}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            clearPassphrase: event.target.checked,
                            passphrase: event.target.checked ? "" : current.passphrase
                          }))
                        }
                      />
                    </>
                  ) : null}
                </>
              )}

              <InlineNote>{t("credential.editSecretNote")}</InlineNote>

              <div className="editor-actions">
                <Button onClick={closeModal} variant="secondary">{t("common.cancel")}</Button>
                <Button disabled={submitting} type="submit" variant="primary">
                  {submitting ? t("credential.saving") : t("credential.save")}
                </Button>
              </div>
            </form>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
