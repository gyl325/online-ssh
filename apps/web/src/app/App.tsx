import { RouterProvider } from "react-router-dom";
import type { ReactNode } from "react";

import { AuthProvider } from "../features/auth/AuthContext";
import { BootstrapProvider, useBootstrap } from "../features/bootstrap/BootstrapContext";
import { FingerprintDialogProvider } from "../features/fingerprint/FingerprintDialogContext";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ConfirmDialogProvider } from "../features/ui/ConfirmDialogContext";
import { ToastProvider } from "../features/ui/ToastContext";
import { WorkspaceProvider } from "../features/workspace/WorkspaceContext";
import { router } from "./router";

export function App() {
  return (
    <PreferencesProvider>
      <ToastProvider>
        <BootstrapProvider>
          <BootstrapAwareAuthProvider>
            <WorkspaceProvider>
              <ConfirmDialogProvider>
                <FingerprintDialogProvider>
                  <RouterProvider router={router} />
                </FingerprintDialogProvider>
              </ConfirmDialogProvider>
            </WorkspaceProvider>
          </BootstrapAwareAuthProvider>
        </BootstrapProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

function BootstrapAwareAuthProvider({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrap();
  return <AuthProvider sessionCheckEnabled={bootstrap.status === "ready"}>{children}</AuthProvider>;
}
