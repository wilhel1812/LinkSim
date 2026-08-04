ALTER TABLE simulations
ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status);
