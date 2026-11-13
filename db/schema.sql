CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  name_pt TEXT NOT NULL,
  scientific_name TEXT,
  botanical_family TEXT,
  role_in_rotation TEXT,
  nitrogen_impact TEXT,
  nitrogen_fixation_kg_ha NUMERIC NOT NULL DEFAULT 0,
  climate_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  soil_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  angola_calendar JSONB NOT NULL DEFAULT '{}'::jsonb,
  good_successors JSONB NOT NULL DEFAULT '[]'::jsonb,
  pest_risk_if_monoculture JSONB NOT NULL DEFAULT '[]'::jsonb,
  faostat_item TEXT,
  faostat_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plants_faostat_item_idx ON plants (faostat_item);