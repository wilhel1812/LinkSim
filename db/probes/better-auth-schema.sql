SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM auth_user LIMIT 0;
SELECT id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId FROM auth_session LIMIT 0;
SELECT id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt FROM auth_account LIMIT 0;
SELECT id, identifier, value, expiresAt, createdAt, updatedAt FROM auth_verification LIMIT 0;
SELECT id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid FROM auth_passkey LIMIT 0;
SELECT id, key, count, lastRequest FROM auth_rate_limit LIMIT 0;
SELECT auth_user_id, linksim_user_id, created_at FROM auth_identity_map LIMIT 0;
SELECT id, legacy_user_id, access_subject, access_issued_at, auth_user_id,
  created_at, expires_at, consumed_at, completion_token FROM auth_migration_attempt LIMIT 0;
SELECT userId FROM auth_session INDEXED BY auth_session_userId_idx LIMIT 0;
SELECT userId FROM auth_account INDEXED BY auth_account_userId_idx LIMIT 0;
SELECT providerId, accountId FROM auth_account INDEXED BY auth_account_provider_account_idx LIMIT 0;
SELECT identifier FROM auth_verification INDEXED BY auth_verification_identifier_idx LIMIT 0;
SELECT userId FROM auth_passkey INDEXED BY auth_passkey_userId_idx LIMIT 0;
SELECT credentialID FROM auth_passkey INDEXED BY auth_passkey_credentialID_idx LIMIT 0;
SELECT expires_at, consumed_at FROM auth_migration_attempt
  INDEXED BY auth_migration_attempt_expiry_idx LIMIT 0;
SELECT auth_user_id, expires_at FROM auth_migration_attempt
  INDEXED BY auth_migration_attempt_auth_user_idx LIMIT 0;
