-- ============================================================================
-- PLAYER GAMES & AVAILABILITY (ESPN game logs x BBRef schedule)
-- ESPN game logs include NBA Cup finals and play-in games, which do not count
-- as regular season; we keep only games that match a BBRef regular-season
-- game for that team on that (US) date.
-- ============================================================================
CREATE OR REPLACE TABLE stg.player_games AS
WITH logs AS (
    SELECT l.season, x.player_id, l.event_id,
           -- ESPN stamps games in UTC; US evening tip-offs fall on the next UTC day.
           CAST((CAST(l.game_date_utc AS TIMESTAMPTZ) AT TIME ZONE 'America/New_York') AS DATE) AS game_date,
           m.bbref AS team, TRY_CAST(l.minutes AS INT) AS minutes, TRY_CAST(l.points AS INT) AS pts,
           TRY_CAST(l.totalRebounds AS INT) AS reb, TRY_CAST(l.assists AS INT) AS ast
    FROM raw.espn_gamelogs l
    JOIN xwalk.player_ids x ON x.espn_id = l.espn_id
    JOIN (VALUES ('ATL','ATL'),('BOS','BOS'),('BKN','BRK'),('CHA','CHO'),('CHI','CHI'),('CLE','CLE'),
                 ('DAL','DAL'),('DEN','DEN'),('DET','DET'),('GS','GSW'),('HOU','HOU'),('IND','IND'),
                 ('LAC','LAC'),('LAL','LAL'),('MEM','MEM'),('MIA','MIA'),('MIL','MIL'),('MIN','MIN'),
                 ('NO','NOP'),('NY','NYK'),('OKC','OKC'),('ORL','ORL'),('PHI','PHI'),('PHX','PHO'),
                 ('POR','POR'),('SAC','SAC'),('SA','SAS'),('TOR','TOR'),('UTAH','UTA'),('WSH','WAS'))
         AS m(espn, bbref) ON m.espn = l.team_abbr
)
SELECT l.*, tg.game_id, tg.game_num, tg.is_home, tg.is_b2b_second, tg.travel_miles, tg.result
FROM logs l
JOIN stg.team_games tg ON tg.season = l.season AND tg.team = l.team AND tg.game_date = l.game_date;

-- For every team game while a player was on that team: played or missed.
-- Stint = from the player's first to last game with a team; the first stint
-- starts at game 1 and the last runs to the end of the season, so injuries at
-- either end of the year count as missed games.
CREATE OR REPLACE TABLE mart.player_availability AS
WITH stints AS (
    SELECT season, player_id, team, min(game_date) AS first_g, max(game_date) AS last_g
    FROM stg.player_games GROUP BY ALL
), bounded AS (
    SELECT s.*,
           CASE WHEN first_g = min(first_g) OVER p THEN DATE '1900-01-01' ELSE first_g END AS stint_start,
           CASE WHEN last_g = max(last_g) OVER p
                     AND (s.season < (SELECT max(season) FROM stg.team_games))  -- season in progress: stop today
                THEN DATE '2100-01-01' ELSE last_g END AS stint_end
    FROM stints s WINDOW p AS (PARTITION BY season, player_id)
)
SELECT b.season, b.player_id, tg.team, tg.game_id, tg.game_date, tg.game_num, tg.opp, tg.is_home,
       tg.is_b2b_second, tg.travel_miles, tg.rest_days, tg.result,
       pg.minutes, pg.pts, pg.reb, pg.ast,
       pg.game_id IS NOT NULL AS played
FROM bounded b
JOIN stg.team_games tg ON tg.season = b.season AND tg.team = b.team
                      AND tg.game_date BETWEEN b.stint_start AND b.stint_end
LEFT JOIN stg.player_games pg ON pg.season = b.season AND pg.player_id = b.player_id AND pg.game_id = tg.game_id;
