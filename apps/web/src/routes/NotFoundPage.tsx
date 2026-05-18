import { Link } from "react-router-dom";

import { usePreferences } from "../features/preferences/PreferencesContext";

export function NotFoundPage() {
  const { t } = usePreferences();

  return (
    <div className="login-screen">
      <section className="login-card">
        <p className="eyebrow">404</p>
        <h1>{t("common.notFoundTitle")}</h1>
        <p className="login-copy">{t("common.notFoundCopy")}</p>
        <Link className="ui-button ui-button-primary ui-button-md" to="/dashboard">
          {t("common.backToDashboard")}
        </Link>
      </section>
    </div>
  );
}
