PRAGMA foreign_keys = OFF;

-- Set all existing resources to private (issue #96).
UPDATE sites SET visibility = 'private';
UPDATE simulations SET visibility = 'private';

PRAGMA foreign_keys = ON;
