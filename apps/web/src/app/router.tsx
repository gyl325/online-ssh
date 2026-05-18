import { Navigate, createBrowserRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { useBootstrap } from "../features/bootstrap/BootstrapContext";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { PublicRoute } from "../features/auth/PublicRoute";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "../routes/LoginPage";
import { NotFoundPage } from "../routes/NotFoundPage";
import { SetupPage } from "../routes/SetupPage";
import { TerminalSharePage } from "../routes/TerminalSharePage";

function BootstrapGate({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrap();
  const { t } = usePreferences();

  if (bootstrap.status === "checking") {
    return (
      <div className="center-screen">
        <section className="status-card">
          <p className="eyebrow">{t("setup.eyebrow")}</p>
          <h1>{t("common.initializingApp")}</h1>
          <p>{t("setup.copy")}</p>
        </section>
      </div>
    );
  }

  if (bootstrap.setupRequired) {
    return <Navigate replace to="/setup" />;
  }

  return <>{children}</>;
}

function SetupRoute() {
  const bootstrap = useBootstrap();
  const { t } = usePreferences();

  if (bootstrap.status === "checking") {
    return (
      <div className="center-screen">
        <section className="status-card">
          <p className="eyebrow">{t("setup.eyebrow")}</p>
          <h1>{t("common.initializingApp")}</h1>
          <p>{t("setup.copy")}</p>
        </section>
      </div>
    );
  }

  if (!bootstrap.setupRequired) {
    return <Navigate replace to="/dashboard" />;
  }

  return <SetupPage onSetupComplete={bootstrap.markInitialized} setupTokenRequired={bootstrap.setupTokenRequired} />;
}

export const router = createBrowserRouter([
  {
    path: "/setup",
    element: <SetupRoute />
  },
  {
    path: "/share/terminal/:token",
    element: <TerminalSharePage />
  },
  {
    element: (
      <BootstrapGate>
        <PublicRoute />
      </BootstrapGate>
    ),
    children: [
      {
        path: "/login",
        element: <LoginPage />
      }
    ]
  },
  {
    element: (
      <BootstrapGate>
        <ProtectedRoute />
      </BootstrapGate>
    ),
    children: [
      {
        path: "/",
        element: <AppShell />,
        children: [
          {
            index: true,
            element: <Navigate replace to="/dashboard" />
          },
          {
            path: "dashboard",
            element: null
          },
          {
            path: "credentials",
            element: null
          },
          {
            path: "hosts",
            element: null
          },
          {
            path: "terminal",
            element: null
          },
          {
            path: "files",
            element: null
          },
          {
            path: "transfers",
            element: null
          },
          {
            path: "audit",
            element: null
          },
          {
            path: "audit/:logId",
            element: null
          },
          {
            path: "admin",
            element: null
          },
          {
            path: "profile",
            element: null
          }
        ]
      }
    ]
  },
  {
    path: "*",
    element: <NotFoundPage />
  }
]);
