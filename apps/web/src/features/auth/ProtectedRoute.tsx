import { Navigate, Outlet, useLocation } from "react-router-dom";

import { usePreferences } from "../preferences/PreferencesContext";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  const { t } = usePreferences();

  if (auth.status === "checking") {
    return (
      <div className="center-screen">
        <section className="status-card">
          <p className="eyebrow">Session Check</p>
          <h1>{t("common.checkingSession")}</h1>
          <p>{t("common.protectedSessionProbe")}</p>
        </section>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
