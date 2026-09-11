CREATE INDEX IF NOT EXISTS probe_account_provider_subject_idx ON probe_account (providerId, accountId);
CREATE INDEX IF NOT EXISTS probe_rate_limit_last_request_idx ON probe_rate_limit (lastRequest);
