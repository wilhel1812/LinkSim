-- Migration: Add calculation_jobs table for async terrain calculations
-- Created: 2026-03-25

CREATE TABLE IF NOT EXISTS calculation_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    input_json TEXT NOT NULL,
    result_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calculation_jobs_status ON calculation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_calculation_jobs_created_at ON calculation_jobs(created_at);
