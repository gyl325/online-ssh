import { render, type RenderOptions } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { AuthProvider } from "../features/auth/AuthContext";
import { FingerprintDialogProvider } from "../features/fingerprint/FingerprintDialogContext";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ConfirmDialogProvider } from "../features/ui/ConfirmDialogContext";
import { ToastProvider } from "../features/ui/ToastContext";
import { WorkspaceProvider } from "../features/workspace/WorkspaceContext";

function PreferencesWrapper({ children }: PropsWithChildren) {
  return (
    <PreferencesProvider>
      <ToastProvider>{children}</ToastProvider>
    </PreferencesProvider>
  );
}

function AuthWrapper({ children }: PropsWithChildren) {
  return (
    <PreferencesProvider>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

function PageWrapper({
  children,
  route = "/"
}: PropsWithChildren<{ route?: string }>) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <PreferencesProvider>
        <ToastProvider>
          <WorkspaceProvider>
            <ConfirmDialogProvider>
              <FingerprintDialogProvider>{children}</FingerprintDialogProvider>
            </ConfirmDialogProvider>
          </WorkspaceProvider>
        </ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>
  );
}

export function renderWithPreferences(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, {
    wrapper: PreferencesWrapper,
    ...options
  });
}

export function renderWithAuth(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, {
    wrapper: AuthWrapper,
    ...options
  });
}

export function renderWithPageProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { route?: string }
) {
  const { route, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: ({ children }) => <PageWrapper route={route}>{children}</PageWrapper>,
    ...renderOptions
  });
}
