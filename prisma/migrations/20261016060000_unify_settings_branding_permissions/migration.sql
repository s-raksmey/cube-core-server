-- Branding now uses SETTINGS_VIEW and SETTINGS_UPDATE. Retire the independent
-- grants without widening site-settings access for roles that held only a
-- branding grant.
DELETE FROM "role_permissions"
WHERE "permission" IN ('BRANDING_VIEW', 'BRANDING_UPDATE');
