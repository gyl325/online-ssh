import { Navigate, Outlet } from "react-router-dom";

import { usePreferences } from "../preferences/PreferencesContext";
import { useAuth } from "./AuthContext";

export function PublicRoute() {
  const auth = useAuth();
  const { t } = usePreferences();

  if (auth.status === "checking") {
    return (
      <div className="center-screen">
        <section className="status-card">
          <p className="eyebrow">Session Check</p>
          <h1>{t("common.initializingApp")}</h1>
          <p>{t("common.validCookieRedirect")}</p>
        </section>
      </div>
    );
  }

  if (auth.isAuthenticated) {
    return <Navigate replace to="/dashboard" />;
  }

  return <Outlet />;
}
