-- The biosecurity tolerance setting was removed (alerts and the health list never disagree):
-- drop any value an organisation stored for it.
DELETE FROM "Setting" WHERE "key" = 'biosecurityWarningDays';
