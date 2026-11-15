-- Field Shift: PostgreSQL Database Schema
-- Crop catalog and agro-ecological parameters

CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  name_en TEXT,
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
  gaez_code TEXT,
  gaez_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plants ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS gaez_code TEXT;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS gaez_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS plants_faostat_item_idx ON plants (faostat_item);
CREATE INDEX IF NOT EXISTS plants_gaez_code_idx ON plants (gaez_code);

-- FAO GAEZ v4 Crop Catalog (51 modeled crops)
CREATE TABLE IF NOT EXISTS gaez_crops (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_pt TEXT NOT NULL,
  scientific_name TEXT,
  botanical_family TEXT,
  crop_group TEXT,
  photosynthetic_pathway TEXT,
  water_need_mm_min NUMERIC,
  water_need_mm_max NUMERIC,
  cycle_days_min INTEGER,
  cycle_days_max INTEGER,
  drought_tolerance TEXT,
  angola_relevance TEXT,
  summary_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
