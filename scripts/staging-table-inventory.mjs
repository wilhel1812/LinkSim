// New tables must be classified explicitly before any refresh can proceed.
export const applicationTables = [
  'users', 'deleted_users', 'verified_identity_claims', 'identity_subject_states',
  'identity_lifecycle_meta', 'sites', 'site_roles', 'simulations', 'simulation_roles',
  'resource_changes', 'simulation_path_leaderboard_entries', 'user_identity_audit',
  'site_notice', 'site_notice_audit',
];
export const excludedTables = [
  '_cf_KV', 'd1_migrations', 'sqlite_sequence',
  'calculation_jobs', // Transient inputs/results stay in their original environment.
  'auth_user', 'auth_account', 'auth_session', 'auth_verification', 'auth_passkey',
  'auth_rate_limit', 'auth_identity_map', 'auth_migration_attempt',
];
export function selectExportTables(names) {
  for (const name of names) {
    if (!applicationTables.includes(name) && !excludedTables.includes(name)) {
      throw new Error(`Unclassified table: ${name}`);
    }
  }
  return applicationTables.filter(name => names.includes(name));
}
