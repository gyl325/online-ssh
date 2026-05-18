BEGIN;

DROP TRIGGER IF EXISTS trg_system_settings_set_updated_at ON system_settings;
DROP TABLE IF EXISTS system_settings;

COMMIT;
