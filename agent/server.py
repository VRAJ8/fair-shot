"""Fair Shot AI: a data analyst agent over the warehouse, plus a negotiation-brief writer.

    GEMINI_API_KEY=... python -m agent.server        # free tier (default provider)
    AI_PROVIDER=claude ANTHROPIC_API_KEY=... python -m agent.server
                                                     # serves http://127.0.0.1:8787

Two interchangeable providers run the same tool loop: Google Gemini (free tier,
used on the live site) and Anthropic Claude. AI_PROVIDER picks one; otherwise
Gemini is used unless only an Anthropic key is configured.

Endpoints
  GET  /api/health          -> is the agent configured?
  POST /api/ask             -> {question, history?} -> answer + the SQL it ran
  POST /api/brief           -> {player_id} -> streamed markdown (text/event-stream)

The agent answers questions by writing SQL against a slim copy of the
warehouse (agent/fairshot.duckdb, built by `python -m pipeline.serve_db`)
through a read-only, sandboxed tool: the connection is opened read-only with
external file access disabled and the configuration locked, only a single
SELECT/WITH statement is accepted, and results are capped.

Because the deployed endpoints spend real API credits, each visitor is rate
limited, inputs are capped, and AGENT_ENABLED=false pauses the AI entirely.
Also set a monthly spend limit in the Anthropic Console.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

import anthropic
import duckdb
from anthropic import beta_tool
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as gtypes

# google-genai's HTTP transport (httpx2 in current releases, httpx in older ones).
try:
    import httpx2 as _http
except ImportError:  # pragma: no cover
    import httpx as _http
TRANSPORT_ERRORS = (_http.TimeoutException, _http.TransportError)
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
SLIM_DB = ROOT / "agent" / "fairshot.duckdb"
DB_PATH = Path(os.environ.get("FAIRSHOT_DB") or (SLIM_DB if SLIM_DB.exists() else ROOT / "data" / "warehouse.duckdb"))
PLAYERS = ROOT / "web" / "public" / "data" / "players"
MODEL = "claude-opus-5-5"
# Opt into server-side refusal fallbacks: on a policy decline the API re-runs
# the request on a fallback model chosen for the refusal category.
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
MAX_ROWS = 200
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")  # stable, on the Gemini free tier
# Free-tier capacity varies: when a model is overloaded (503) or rate limited
# (429), fall back to the next stable free-tier model.
GEMINI_FALLBACKS = [m.strip() for m in os.environ.get(
    "GEMINI_FALLBACK_MODELS", "gemini-3.8-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
GEMINI_CALL_TIMEOUT_MS = 30_000   # per request
ASK_DEADLINE_S = 120              # per question, across models and tool rounds
OVERLOADED = {429, 500, 503, 504}
NO_CREDENTIALS = "The agent has no Anthropic credentials. Set ANTHROPIC_API_KEY and restart it."
NO_GEMINI_KEY = "The agent has no Gemini key. Set GEMINI_API_KEY (free at Google AI Studio) and restart it."
GEMINI_BUSY = "The free AI tier is at its limit right now. Please try again in a minute."


def gemini_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def provider() -> str:
    chosen = os.environ.get("AI_PROVIDER", "").lower()
    if chosen in ("gemini", "claude"):
        return chosen
    if os.environ.get("ANTHROPIC_API_KEY") and not gemini_key():
        return "claude"
    return "gemini"

MAX_QUESTION_CHARS = 600


def agent_enabled() -> bool:
    return os.environ.get("AGENT_ENABLED", "true").lower() not in ("0", "false", "no", "off")


class RateLimiter:
    """Sliding-window limits per visitor, plus a ceiling for this server instance.

    State lives in memory, so on a serverless host each warm instance keeps
    its own counts. That bounds abuse; the hard cost guarantee is the monthly
    spend limit set in the Anthropic Console.
    """

    def __init__(self, per_visitor: int, window_s: int, per_instance_hour: int):
        self.per_visitor, self.window_s, self.per_instance_hour = per_visitor, window_s, per_instance_hour
        self.hits: dict[str, deque] = defaultdict(deque)
        self.instance: deque = deque()
        self.lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.time()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            while self.instance and now - self.instance[0] > 3600:
                self.instance.popleft()
            if len(q) >= self.per_visitor:
                wait = int(self.window_s - (now - q[0])) + 1
                raise HTTPException(429, f"You've hit the demo limit. Try again in about {max(1, wait // 60)} min.")
            if len(self.instance) >= self.per_instance_hour:
                raise HTTPException(429, "The AI analyst is busy right now. Please try again later.")
            q.append(now)
            self.instance.append(now)


ASK_LIMIT = RateLimiter(per_visitor=int(os.environ.get("ASK_LIMIT", "10")), window_s=600,
                        per_instance_hour=int(os.environ.get("INSTANCE_LIMIT", "120")))
BRIEF_LIMIT = RateLimiter(per_visitor=int(os.environ.get("BRIEF_LIMIT", "4")), window_s=600,
                          per_instance_hour=int(os.environ.get("INSTANCE_LIMIT", "120")))


def visitor(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() or request.headers.get("x-real-ip")
            or (request.client.host if request.client else "unknown"))


def guard(request: Request, limiter: RateLimiter) -> None:
    if not agent_enabled():
        raise HTTPException(503, "The AI analyst is paused right now. Everything else on the site works.")
    limiter.check(visitor(request))

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
  Every table with a season also has season_label (e.g. '2025-26'): always select it and use it when you write seasons.
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
        # home_directory: serverless hosts have a read-only home; /tmp is writable.
        con = duckdb.connect(str(DB_PATH), read_only=True,
                             config={"home_directory": "/tmp", "enable_external_access": False,
                                     "lock_configuration": True})
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
_gemini: genai.Client | None = None
_system: str | None = None


def gemini_client() -> genai.Client:
    global _gemini
    if _gemini is None:
        _gemini = genai.Client(api_key=gemini_key(), http_options=gtypes.HttpOptions(
            timeout=GEMINI_CALL_TIMEOUT_MS,
            retry_options=gtypes.HttpRetryOptions(attempts=2, initial_delay=1.0, max_delay=3.0,
                                                  http_status_codes=sorted(OVERLOADED)),
        ))
    return _gemini


def gemini_models() -> list[str]:
    return list(dict.fromkeys([GEMINI_MODEL, *GEMINI_FALLBACKS]))


class Overloaded(Exception):
    """This model is busy or slow right now; try the next one."""


def call_gemini(fn, model: str):
    try:
        return fn(model)
    except genai_errors.APIError as exc:
        if exc.code in OVERLOADED:
            raise Overloaded(f"{model}: {exc.code}") from exc
        if "api key" in str(exc.message or "").lower():
            raise HTTPException(401, NO_GEMINI_KEY)
        raise HTTPException(502, f"Gemini API error {exc.code}: {exc.message}")
    except TRANSPORT_ERRORS as exc:
        raise Overloaded(f"{model}: {exc.__class__.__name__}") from exc


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
    if provider() == "gemini":
        configured, model = bool(gemini_key()), " → ".join(gemini_models())
    else:
        configured = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                          or os.environ.get("ANTHROPIC_PROFILE") or (Path.home() / ".config" / "anthropic").exists())
        model = MODEL
    return {"ok": True, "provider": provider(), "model": model, "configured": configured,
            "enabled": agent_enabled(), "warehouse": DB_PATH.exists()}


def logged_sql(query: str, queries: list[dict]) -> dict:
    """Run a query for either provider and record it for the "how I got this" panel."""
    try:
        result = execute_readonly(query)
    except Exception as exc:  # returned to the model so it can fix the query
        queries.append({"sql": query, "error": str(exc)})
        return {"error": str(exc)}
    queries.append({"sql": query, **result})
    return result


SQL_TOOL = gtypes.Tool(function_declarations=[gtypes.FunctionDeclaration(
    name="run_sql",
    description="Run one read-only DuckDB SELECT query against the Fair Shot warehouse and return the rows as JSON.",
    parameters_json_schema={
        "type": "object",
        "properties": {"query": {"type": "string", "description":
                                 "A single SELECT or WITH statement. Schema-qualify tables, e.g. model.fair_value."}},
        "required": ["query"],
    },
)])
MAX_TOOL_ROUNDS = 6


def ask_gemini(history: list[dict], question: str, queries: list[dict]) -> str:
    """Manual tool loop: the model asks for SQL, we run it in the sandbox, repeat.
    If a model is overloaded, start the question over on the next free-tier model."""
    if not gemini_key():
        raise HTTPException(401, NO_GEMINI_KEY)
    deadline = time.time() + ASK_DEADLINE_S
    config = gtypes.GenerateContentConfig(
        system_instruction=system_prompt(), tools=[SQL_TOOL], max_output_tokens=8192,
        automatic_function_calling=gtypes.AutomaticFunctionCallingConfig(disable=True),
    )
    for model in gemini_models():
        if time.time() > deadline:
            break
        queries.clear()
        contents = [gtypes.Content(role="user" if h["role"] == "user" else "model",
                                   parts=[gtypes.Part.from_text(text=h["content"])]) for h in history]
        contents.append(gtypes.Content(role="user", parts=[gtypes.Part.from_text(text=question)]))
        try:
            for _ in range(MAX_TOOL_ROUNDS):
                if time.time() > deadline:
                    raise Overloaded("deadline")
                response = call_gemini(lambda m: gemini_client().models.generate_content(
                    model=m, contents=contents, config=config), model)
                calls = response.function_calls or []
                if not calls:
                    return (response.text or "").strip()
                # Keep the model's turn verbatim (it carries the call and any thought signatures).
                contents.append(response.candidates[0].content)
                results = [gtypes.Part.from_function_response(
                    name=call.name,
                    response=logged_sql(str((call.args or {}).get("query", "")), queries) if call.name == "run_sql"
                    else {"error": f"Unknown tool {call.name}"}) for call in calls]
                # The Gemini API accepts only "user" and "model" roles; tool results go in a user turn.
                contents.append(gtypes.Content(role="user", parts=results))
            return "I ran out of query steps before finishing. Try a narrower question."
        except Overloaded as exc:
            print(f"  gemini fallback: {exc}", flush=True)
            continue
    raise HTTPException(503, GEMINI_BUSY)


class AskBody(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/ask")
def ask(body: AskBody, request: Request):
    if not body.question.strip():
        raise HTTPException(400, "Empty question")
    if len(body.question) > MAX_QUESTION_CHARS:
        raise HTTPException(400, f"Please keep questions under {MAX_QUESTION_CHARS} characters.")
    guard(request, ASK_LIMIT)
    queries: list[dict] = []

    @beta_tool
    def run_sql(query: str) -> str:
        """Run one read-only DuckDB SELECT query against the Fair Shot warehouse and return the rows as JSON.

        Args:
            query: A single SELECT or WITH statement. Schema-qualify tables, e.g. model.fair_value.
        """
        return json.dumps(logged_sql(query, queries))

    # Prior turns are text only; the SQL behind them is not replayed.
    history = [{"role": h["role"], "content": str(h["content"])[:2000]} for h in body.history[-6:]
               if h.get("role") in ("user", "assistant") and h.get("content")]
    # The API requires the first message to be from the user.
    while history and history[0]["role"] != "user":
        history.pop(0)
    if provider() == "gemini":
        answer = ask_gemini(history, body.question.strip(), queries)
        return {"answer": answer or "(no answer)", "queries": queries[-4:]}
    messages = history + [{"role": "user", "content": body.question.strip()}]
    try:
        runner = client().beta.messages.tool_runner(
            model=MODEL, max_tokens=16000, max_iterations=6,
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
Write in plain, confident English for a player and their agent. Write money as $45.9M (never raw dollars or cents),
shares of the cap with one decimal (29.7%), and seasons as 2025-26 (the dossier's "label" fields).

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
def brief(body: BriefBody, request: Request):
    if not re.fullmatch(r"[a-z0-9]{3,12}", body.player_id):
        raise HTTPException(400, "Bad player id")
    path = PLAYERS / f"{body.player_id}.json"
    if not path.exists():
        raise HTTPException(404, "Unknown player")
    guard(request, BRIEF_LIMIT)
    doc = json.loads(path.read_text())
    # The dossier: drop the game-by-game log, keep the season summaries.
    doc["seasons"] = doc["seasons"][-6:]
    doc["availability"] = {s: {k: v for k, v in a.items() if k != "games"} for s, a in doc.get("availability", {}).items()}
    dossier = json.dumps(doc, ensure_ascii=False)
    prompt = f"Dossier:\n{dossier}\n\nWrite the brief."

    def gemini_events():
        if not gemini_key():
            yield f"data: {json.dumps({'error': NO_GEMINI_KEY})}\n\n"
        else:
            config = gtypes.GenerateContentConfig(system_instruction=BRIEF_SYSTEM, max_output_tokens=4096)
            sent, error = False, GEMINI_BUSY
            for model in gemini_models():
                try:
                    for chunk in gemini_client().models.generate_content_stream(
                            model=model, contents=prompt, config=config):
                        if chunk.text:
                            sent = True
                            yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                    break
                except genai_errors.APIError as exc:
                    if exc.code in OVERLOADED and not sent:
                        continue  # nothing streamed yet: try the next model
                    error = GEMINI_BUSY if exc.code in OVERLOADED else f"Gemini API error {exc.code}: {exc.message}"
                except TRANSPORT_ERRORS:
                    if not sent:
                        continue
                yield f"data: {json.dumps({'error': error})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'error': GEMINI_BUSY})}\n\n"
        yield "data: [DONE]\n\n"

    if provider() == "gemini":
        return StreamingResponse(gemini_events(), media_type="text/event-stream")

    def events():
        try:
            with client().beta.messages.stream(
                model=MODEL, max_tokens=8000, system=BRIEF_SYSTEM, output_config={"effort": "medium"},
                messages=[{"role": "user", "content": prompt}], **FALLBACK,
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
