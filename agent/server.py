"""Fair Shot AI: a data analyst agent over the warehouse, plus a negotiation-brief writer.

    ANTHROPIC_API_KEY=... python -m agent.server        # serves http://127.0.0.1:8787

Endpoints
  GET  /api/health          -> is the agent configured?
  POST /api/ask             -> {question, history?} -> answer + the SQL it ran
  POST /api/brief           -> {player_id} -> streamed markdown (text/event-stream)

The agent answers questions by writing SQL against the DuckDB warehouse
through a read-only, sandboxed tool: the connection is opened read-only with
external file access disabled and the configuration locked, only a single
SELECT/WITH statement is accepted, and results are capped.
"""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

import anthropic
import duckdb
from anthropic import beta_tool
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
WAREHOUSE = ROOT / "data" / "warehouse.duckdb"
PLAYERS = ROOT / "web" / "public" / "data" / "players"
MODEL = "claude-opus-5-5"
# Opt into server-side refusal fallbacks: on a policy decline the API re-runs
# the request on a fallback model chosen for the refusal category.
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
MAX_ROWS = 200
NO_CREDENTIALS = "The agent has no Anthropic credentials. Set ANTHROPIC_API_KEY and restart it."

# Tables the agent may read, documented once (stable text -> cacheable prompt).
TABLE_NOTES = {
    "model.fair_value": "One row per player-season (2011-12 = season 2012 ... 2026-27 = 2027, the season in progress). "
                        "salary (USD, NULL if unknown), fair_value (USD, wins-based market value), surplus = fair_value - salary "
                        "(positive = underpaid), war = 2.7*VORP, war82 = WAR scaled to 82 games, tier = contract tier by % of cap.",
    "model.market": "Per season: salary_cap, replacement_salary (league minimum), dollars_per_war (market price of one win).",
    "model.projections": "Projected WAR for 2026-27..2028-29 from the 2025-26 season: horizon 1-3, war_p10/war_p50/war_p90 (80% interval).",
    "model.comps": "For each 2025-26 player: the 6 most similar historical player-seasons (comp_name, comp_season, similarity 0-100, comp_next_pct_cap = share of cap the comp earned the next season).",
    "stg.player_seasons": "Box score + advanced stats per player-season (games, mp, pts, trb, ast, ts_pct, usg_pct, bpm, obpm, dbpm, vorp, ws, per, teams list).",
    "stg.salaries": "Salary per player-season (sum of distinct contract amounts across team payroll tables).",
    "stg.cap": "Salary cap by season.",
    "stg.rosters": "Bio facts per player-team-season: jersey, height_in, weight_lb, birth_date, years_experience, college, country.",
    "stg.games": "Every game: game_date, home, away, scores, arena_name, game_type (regular / playoffs / play-in / cup-final).",
    "stg.team_games": "Each regular-season game from one team's side: rest_days, is_b2b_second, travel_miles since previous game, tz_shift.",
    "mart.player_availability": "2025-26 and 2026-27: every team game while a player was on the team, played true/false, minutes, pts, is_b2b_second, travel_miles.",
}

SYSTEM_TEMPLATE = """You are the analyst behind Fair Shot, a data project about NBA player pay viewed from the players' side \
(the perspective of a players' union). You answer questions using the warehouse through the run_sql tool.

How to work:
- Query before you claim. Every number in your answer must come from a query result in this conversation.
- Seasons are named by the year they end: season 2026 = 2025-26. The latest complete season is 2026; 2027 is in progress.
- Player names are stored with accents (e.g. 'Nikola Jokić'). Match names with ILIKE or strip_accents(), e.g. strip_accents(player_name) ILIKE '%jokic%'.
- Money is in US dollars. Present it as $12.3M. Fair value is a model estimate, so say "estimated" or "fair value", never "should be paid".
- Keep queries focused; results are capped at {max_rows} rows.
- Answer in a few short paragraphs or a compact markdown table. Lead with the direct answer. Mention a caveat only if it changes the reading (small samples, the season in progress, injuries).
- If the data cannot answer the question, say so and say what it can answer instead.

Method notes: fair value = league minimum + max(WAR,0) x market $ per WAR for that season; WAR = 2.7 x VORP (Basketball-Reference). \
Projections are gradient-boosted quantile models with conformal calibration. Comps are nearest neighbours on era-adjusted stats.

Tables (DuckDB SQL; schema-qualify table names):
{schema}"""


def schema_text() -> str:
    con = sandboxed_connection()
    lines = []
    for table, note in TABLE_NOTES.items():
        schema, name = table.split(".")
        cols = con.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position", [schema, name]).fetchall()
        if cols:
            lines.append(f"- {table}: {note}\n  columns: " + ", ".join(f"{c} {t.lower()}" for c, t in cols))
    return "\n".join(lines)


_local = threading.local()


def sandboxed_connection() -> duckdb.DuckDBPyConnection:
    con = getattr(_local, "con", None)
    if con is None:
        con = duckdb.connect(str(WAREHOUSE), read_only=True,
                             config={"enable_external_access": False, "lock_configuration": True})
        _local.con = con
    return con


FORBIDDEN = re.compile(r"\b(attach|detach|copy|install|load|pragma|set|reset|call|export|import|create|insert|update|delete|drop|alter)\b", re.I)


def execute_readonly(query: str) -> dict:
    q = query.strip().rstrip(";")
    if ";" in q:
        raise ValueError("Only one statement per call.")
    if not re.match(r"^\s*(select|with)\b", q, re.I):
        raise ValueError("Only SELECT / WITH queries are allowed.")
    if FORBIDDEN.search(re.sub(r"'[^']*'", "''", q)):
        raise ValueError("That statement type is not allowed.")
    con = sandboxed_connection()
    cur = con.execute(f"SELECT * FROM ({q}) AS result LIMIT {MAX_ROWS + 1}")
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    return {"columns": cols, "rows": [[_json_safe(v) for v in r] for r in rows[:MAX_ROWS]],
            "truncated": len(rows) > MAX_ROWS}


def _json_safe(v):
    if isinstance(v, float):
        return round(v, 4)
    if isinstance(v, (int, str, bool)) or v is None:
        return v
    return str(v)


app = FastAPI(title="Fair Shot AI")
_client: anthropic.Anthropic | None = None
_system: str | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def system_prompt() -> str:
    global _system
    if _system is None:
        _system = SYSTEM_TEMPLATE.format(max_rows=MAX_ROWS, schema=schema_text())
    return _system


@app.get("/api/health")
def health():
    configured = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                      or os.environ.get("ANTHROPIC_PROFILE") or (Path.home() / ".config" / "anthropic").exists())
    return {"ok": True, "model": MODEL, "configured": configured, "warehouse": WAREHOUSE.exists()}


class AskBody(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/ask")
def ask(body: AskBody):
    if not body.question.strip():
        raise HTTPException(400, "Empty question")
    queries: list[dict] = []

    @beta_tool
    def run_sql(query: str) -> str:
        """Run one read-only DuckDB SELECT query against the Fair Shot warehouse and return the rows as JSON.

        Args:
            query: A single SELECT or WITH statement. Schema-qualify tables, e.g. model.fair_value.
        """
        try:
            result = execute_readonly(query)
        except Exception as exc:  # returned to the model so it can fix the query
            queries.append({"sql": query, "error": str(exc)})
            return json.dumps({"error": str(exc)})
        queries.append({"sql": query, **result})
        return json.dumps(result)

    # Prior turns are text only; the SQL behind them is not replayed.
    history = [{"role": h["role"], "content": str(h["content"])} for h in body.history[-8:]
               if h.get("role") in ("user", "assistant") and h.get("content")]
    messages = history + [{"role": "user", "content": body.question.strip()[:2000]}]
    try:
        runner = client().beta.messages.tool_runner(
            model=MODEL, max_tokens=16000, max_iterations=8,
            system=[{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": "medium"},
            tools=[run_sql], messages=messages, **FALLBACK,
        )
        final = None
        for message in runner:
            final = message
    except anthropic.AuthenticationError:
        raise HTTPException(401, NO_CREDENTIALS)
    except TypeError as exc:  # the SDK raises this when no credentials are configured at all
        if "authentication" in str(exc).lower():
            raise HTTPException(401, NO_CREDENTIALS)
        raise
    except anthropic.RateLimitError:
        raise HTTPException(429, "Rate limited by the Claude API. Try again in a moment.")
    except anthropic.APIStatusError as exc:
        raise HTTPException(502, f"Claude API error {exc.status_code}: {exc.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(503, "Could not reach the Claude API.")
    if final is None:
        raise HTTPException(502, "No response from the model.")
    if final.stop_reason == "refusal":
        return {"answer": "I can't help with that one. Try a question about player pay, value, schedules or availability.",
                "queries": queries}
    text = "".join(b.text for b in final.content if b.type == "text").strip()
    return {"answer": text or "(no answer)", "queries": queries[-4:]}


BRIEF_SYSTEM = """You write one-page negotiation briefs for NBA players, from the player's side, the way a players' \
association analyst would prepare a member for contract talks. You are given a JSON dossier produced by the Fair Shot \
models. Use only numbers that appear in it; never invent statistics, injuries, or context the dossier does not contain. \
Write in plain, confident English for a player and their agent.

Structure (markdown):
# <Player name>: the case
One-sentence thesis.
## What the numbers say
3-4 bullets: production, fair value vs salary (latest complete season and career trend), availability.
## Comparable players
2-3 bullets on the strongest comps and what they earned next, translated to today's cap.
## The ask
A recommended range as a share of the cap and in today's dollars, justified by the projection's median and the comps. \
State the projection's uncertainty honestly.
## Counterarguments to prepare for
2-3 bullets the team will raise (age curve, availability, small samples) with a one-line response each.

Keep it under 450 words."""


class BriefBody(BaseModel):
    player_id: str


@app.post("/api/brief")
def brief(body: BriefBody):
    if not re.fullmatch(r"[a-z0-9]{3,12}", body.player_id):
        raise HTTPException(400, "Bad player id")
    path = PLAYERS / f"{body.player_id}.json"
    if not path.exists():
        raise HTTPException(404, "Unknown player")
    doc = json.loads(path.read_text())
    # The dossier: drop the game-by-game log, keep the season summaries.
    doc["seasons"] = doc["seasons"][-6:]
    doc["availability"] = {s: {k: v for k, v in a.items() if k != "games"} for s, a in doc.get("availability", {}).items()}
    dossier = json.dumps(doc, ensure_ascii=False)

    def events():
        try:
            with client().beta.messages.stream(
                model=MODEL, max_tokens=8000, system=BRIEF_SYSTEM, output_config={"effort": "medium"},
                messages=[{"role": "user", "content": f"Dossier:\n{dossier}\n\nWrite the brief."}], **FALLBACK,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
                final = stream.get_final_message()
                if final.stop_reason == "refusal":
                    yield f"data: {json.dumps({'error': 'The model declined to write this brief.'})}\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'error': NO_CREDENTIALS})}\n\n"
        except TypeError as exc:
            msg = NO_CREDENTIALS if "authentication" in str(exc).lower() else f"Agent error: {exc}"
            yield f"data: {json.dumps({'error': msg})}\n\n"
        except anthropic.APIError as exc:
            yield f"data: {json.dumps({'error': f'Claude API error: {exc}'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8787")))
