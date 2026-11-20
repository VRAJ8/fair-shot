-- ============================================================================
-- STAGING: typed, de-duplicated, one grain per table. Source: raw.*
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS stg;
CREATE SCHEMA IF NOT EXISTS mart;

-- Salary cap by season (BBRef publishes "$154,647,000" strings).
CREATE OR REPLACE TABLE stg.cap AS
SELECT CAST(split_part(year_id, '-', 1) AS INT) + 1                    AS season,
       year_id                                                         AS season_label,
       CAST(regexp_replace(cap, '[$,]', '', 'g') AS BIGINT)            AS salary_cap
FROM raw.bbref_cap_history
WHERE cap <> '';

-- Player x team x season box + advanced stats. Multi-team seasons appear as
-- one row per team plus a combined "2TM"/"3TM" row.
CREATE OR REPLACE TABLE stg.player_team_seasons AS
SELECT t.season, t.player_id, t.name_display AS player_name, t.team_name_abbr AS team,
       t.team_name_abbr LIKE '%TM' AS is_combined_row,
       t.rowid AS source_order,
       t.age, t.pos, t.games, t.games_started, t.mp,
       t.fg, t.fga, t.fg3, t.fg3a, t.ft, t.fta, t.orb, t.drb, t.trb, t.ast, t.stl, t.blk, t.tov, t.pf, t.pts,
       a.per, a.ts_pct, a.usg_pct, a.fg3a_per_fga_pct AS fg3a_rate, a.fta_per_fga_pct AS fta_rate,
       a.orb_pct, a.drb_pct, a.trb_pct, a.ast_pct, a.stl_pct, a.blk_pct, a.tov_pct,
       a.ows, a.dws, a.ws, a.ws_per_48, a.obpm, a.dbpm, a.bpm, a.vorp,
       coalesce(t.awards, a.awards) AS awards
FROM raw.bbref_totals t
LEFT JOIN raw.bbref_advanced a USING (season, player_id, team_name_abbr);

-- One row per player-season: the combined row when a player was traded,
-- otherwise their only row. Teams listed in the order the player joined them.
CREATE OR REPLACE TABLE stg.player_seasons AS
WITH teams AS (
    SELECT season, player_id,
           list(team ORDER BY source_order)            AS teams,
           arg_max(team, source_order)                 AS last_team,
           arg_max(games, games)                       AS max_games_one_team
    FROM stg.player_team_seasons
    WHERE NOT is_combined_row
    GROUP BY ALL
), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY season, player_id ORDER BY is_combined_row DESC) AS rn
    FROM stg.player_team_seasons
)
SELECT r.* EXCLUDE (rn, team, is_combined_row, source_order),
       t.last_team AS team, t.teams, len(t.teams) AS n_teams,
       2.7 * r.vorp AS war   -- BBRef: VORP x 2.7 = wins over replacement
FROM ranked r JOIN teams t USING (season, player_id)
WHERE r.rn = 1;

-- Salaries from team payroll tables. A traded player's contract appears on
-- each team's page with the same amount; a waived-and-resigned player has two
-- different amounts (both are real pay). So: sum of DISTINCT amounts.
CREATE OR REPLACE TABLE stg.salaries AS
WITH s AS (
    SELECT season, player_id, team_id,
           TRY_CAST(regexp_replace(salary, '[$,]', '', 'g') AS BIGINT) AS salary
    FROM raw.bbref_salaries
    WHERE player_id IS NOT NULL
)
SELECT season, player_id,
       sum(DISTINCT salary)                               AS salary,
       max(salary)                                        AS largest_contract,
       count(*)                                           AS n_source_rows,
       count(DISTINCT salary)                             AS n_distinct_amounts,
       list(DISTINCT team_id)                             AS paid_by
FROM s
WHERE salary IS NOT NULL AND salary > 0
GROUP BY ALL;

-- Roster facts (jersey number, bio). Latest team row wins per player-season.
CREATE OR REPLACE TABLE stg.rosters AS
SELECT season, team_id AS team, player_id, player AS player_name,
       NULLIF(number, '') AS jersey, pos,
       TRY_CAST(split_part(height, '-', 1) AS INT) * 12 + TRY_CAST(split_part(height, '-', 2) AS INT) AS height_in,
       TRY_CAST(weight AS INT) AS weight_lb,
       TRY_STRPTIME(birth_date, '%B %d, %Y')::DATE AS birth_date,
       CASE WHEN years_experience = 'R' THEN 0 ELSE TRY_CAST(years_experience AS INT) END AS years_experience,
       NULLIF(college, '') AS college,
       upper(right(flag, 2)) AS country
FROM raw.bbref_rosters
WHERE player_id IS NOT NULL;

-- Games, typed. The postseason starts at BBRef's "Playoffs" divider (through
-- 2018-19) or at the first play-in game (from 2019-20, when the divider
-- disappears from the pages). The NBA Cup final does not count toward the
-- regular season: it is the 67th and last Cup game of a season (60 group,
-- 4 quarterfinal, 2 semifinal, 1 final). Unplayed games have no score.
CREATE OR REPLACE TABLE stg.games AS
WITH g AS (
    SELECT season,
           strptime(left(date_csk, 8), '%Y%m%d')::DATE AS game_date,
           date_csk AS game_id,
           visitor_team_name_code AS away, home_team_name_code AS home,
           TRY_CAST(visitor_pts AS INT) AS away_pts, TRY_CAST(home_pts AS INT) AS home_pts,
           arena_name, NULLIF(game_remarks, '') AS remarks, section
    FROM raw.bbref_schedule
    WHERE date_csk IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY date_csk ORDER BY season) = 1
), post AS (
    SELECT season, coalesce(min(game_date) FILTER (WHERE section = 'Playoffs'),
                            min(game_date) FILTER (WHERE remarks ILIKE 'play-in%')) AS postseason_start
    FROM g GROUP BY 1
), cup AS (
    SELECT season, arg_max(game_id, game_date) AS final_id
    FROM g WHERE remarks IN ('NBA Cup', 'In-Season Tournament')
    GROUP BY 1 HAVING count(*) = 67
)
SELECT g.* EXCLUDE (section),
       CASE WHEN g.home_pts IS NULL THEN 'scheduled'
            WHEN g.remarks ILIKE 'play-in%' THEN 'play-in'
            WHEN post.postseason_start IS NOT NULL AND g.game_date >= post.postseason_start THEN 'playoffs'
            WHEN g.game_id = cup.final_id THEN 'cup-final'
            ELSE 'regular' END AS game_type
FROM g LEFT JOIN post USING (season) LEFT JOIN cup USING (season);

-- Where each game was played (home city, or a neutral site such as London,
-- Mexico City, the 2020 Orlando bubble or NBA Cup semifinals in Las Vegas).
CREATE OR REPLACE TABLE stg.game_sites AS
SELECT g.game_id,
       coalesce(n.city, h.city) AS city, coalesce(n.lat, h.lat) AS lat,
       coalesce(n.lon, h.lon) AS lon, coalesce(n.utc_offset, h.utc_offset) AS utc_offset,
       n.city IS NOT NULL AS neutral_site
FROM stg.games g
JOIN seed.team_geo h ON h.team = g.home
LEFT JOIN seed.neutral_sites n
       ON g.arena_name ILIKE '%' || n.match || '%' OR g.remarks ILIKE '%' || n.match || '%'
QUALIFY row_number() OVER (PARTITION BY g.game_id ORDER BY n.city NULLS LAST) = 1;

-- Each regular-season game from both teams' point of view, with schedule
-- stress: rest days, back-to-backs, miles flown since the last game.
CREATE OR REPLACE TABLE stg.team_games AS
WITH tg AS (
    SELECT g.season, g.game_id, g.game_date, g.home AS team, g.away AS opp, TRUE AS is_home,
           g.home_pts AS pts, g.away_pts AS opp_pts, s.city, s.lat, s.lon, s.utc_offset
    FROM stg.games g JOIN stg.game_sites s USING (game_id) WHERE g.game_type = 'regular'
    UNION ALL
    SELECT g.season, g.game_id, g.game_date, g.away, g.home, FALSE,
           g.away_pts, g.home_pts, s.city, s.lat, s.lon, s.utc_offset
    FROM stg.games g JOIN stg.game_sites s USING (game_id) WHERE g.game_type = 'regular'
), seq AS (
    SELECT tg.*, geo.lat AS home_lat, geo.lon AS home_lon,
           row_number() OVER w AS game_num,
           lag(game_date) OVER w AS prev_date,
           coalesce(lag(tg.lat) OVER w, geo.lat) AS prev_lat,
           coalesce(lag(tg.lon) OVER w, geo.lon) AS prev_lon,
           coalesce(lag(tg.utc_offset) OVER w, geo.utc_offset) AS prev_utc
    FROM tg JOIN seed.team_geo geo ON geo.team = tg.team
    WINDOW w AS (PARTITION BY tg.season, tg.team ORDER BY tg.game_date)
)
SELECT * EXCLUDE (prev_lat, prev_lon, prev_utc),
       date_diff('day', prev_date, game_date) - 1 AS rest_days,
       coalesce(date_diff('day', prev_date, game_date) = 1, FALSE) AS is_b2b_second,
       2 * 3958.8 * asin(sqrt(
           pow(sin(radians(lat - prev_lat) / 2), 2) +
           cos(radians(prev_lat)) * cos(radians(lat)) * pow(sin(radians(lon - prev_lon) / 2), 2)
       )) AS travel_miles,
       abs(utc_offset - prev_utc) AS tz_shift,
       CASE WHEN pts > opp_pts THEN 'W' WHEN pts < opp_pts THEN 'L' END AS result
FROM seq;
