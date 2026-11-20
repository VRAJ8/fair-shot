-- ============================================================================
-- DRAFT & CAREERS (BBRef draft pages + the all-time player index)
-- ============================================================================

-- One row per drafted player. Round 1 had 29 picks before the Bobcats joined
-- and 30 after, except when picks were forfeited: Minnesota lost its 2001,
-- 2002 and 2004 first-rounders (the Joe Smith contract penalty).
CREATE OR REPLACE TABLE stg.draft AS
SELECT draft_year, player_id,
       TRY_CAST(pick_overall AS INT) AS draft_pick,
       CASE WHEN TRY_CAST(pick_overall AS INT) <=
                 CASE WHEN draft_year IN (2001, 2002) THEN 28
                      WHEN draft_year <= 2004 THEN 29 ELSE 30 END
            THEN 1 ELSE 2 END AS draft_round,
       team_id AS draft_team,
       NULLIF(college_name, '') AS draft_college
FROM raw.bbref_draft
WHERE player_id IS NOT NULL
QUALIFY row_number() OVER (PARTITION BY player_id ORDER BY draft_year) = 1;

-- Career span for every player in league history.
CREATE OR REPLACE TABLE stg.careers AS
SELECT player_id, player AS player_name,
       TRY_CAST(year_min AS INT) AS first_season,
       TRY_CAST(year_max AS INT) AS last_season,
       TRY_CAST(year_max AS INT) - TRY_CAST(year_min AS INT) + 1 AS seasons_span,
       pos, height, TRY_CAST(weight AS INT) AS weight_lb,
       TRY_STRPTIME(birth_date, '%B %d, %Y')::DATE AS birth_date,
       NULLIF(colleges, '') AS colleges
FROM raw.bbref_players
WHERE player_id IS NOT NULL;
