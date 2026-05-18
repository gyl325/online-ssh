import { usePreferences } from "../features/preferences/PreferencesContext";

type RoutePageProps = {
  title: string;
  description: string;
  checklist: string[];
};

export function RoutePage({ title, description, checklist }: RoutePageProps) {
  const { t } = usePreferences();

  return (
    <div className="route-page">
      <div className="hero-card">
        <p className="eyebrow">Module Stub</p>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="content-grid">
        <section className="content-card">
          <h4>{t("common.nextStep")}</h4>
          <ul className="check-list">
            {checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="content-card">
          <h4>{t("common.currentStatus")}</h4>
          <p>{t("common.routeStubCopy")}</p>
        </section>
      </div>
    </div>
  );
}
