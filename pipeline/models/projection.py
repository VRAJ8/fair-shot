"""Projection: how much value will a player produce over the next 3 seasons?

A direct multi-horizon model. For each player-season s we predict WAR (scaled
to 82 games) in s+1, s+2 and s+3 from the last three seasons of production,
age and role. A player who is out of the league in a target season counts as
0 WAR (he produced nothing a team paid for); this keeps the model honest about
attrition instead of only learning from survivors.

Gradient boosting gives the median and an 80% interval (10th/90th quantiles).
Validation is out-of-time: train on targets through 2021-22, test on 2022-23
through 2025-26, and compare to two baselines (last season repeated, and a
Marcel-style weighted average with age adjustment).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score

from ..config import CURRENT_SEASON, LAST_FULL_SEASON, PROCESSED
from .common import connect, player_seasons, write

HORIZONS = (1, 2, 3)
TEST_FROM = 2023  # first target season held out
FEATURES = [
    "age", "war82", "war82_l1", "war82_l2", "bpm", "bpm_l1", "bpm_l2", "obpm", "dbpm",
    "mpg", "mpg_l1", "games_share", "games_share_l1", "usg_pct", "ts_pct", "ast_pct", "trb_pct",
    "fg3a_rate", "experience", "seasons_seen",
]


def panel(ps: pd.DataFrame) -> pd.DataFrame:
    ps = ps[ps.season <= LAST_FULL_SEASON].copy()
    ps["games_share"] = ps.games / ps.season_games
    ps = ps.sort_values(["player_id", "season"])
    first = ps.groupby("player_id").season.transform("min")
    ps["experience"] = ps.season - first          # seasons since first in data (left-censored at 2012)
    ps["seasons_seen"] = ps.groupby("player_id").cumcount() + 1
    lagged = ps[["player_id", "season", "war82", "bpm", "mpg", "games_share"]]
    for lag in (1, 2):
        l = lagged.assign(season=lagged.season + lag).add_suffix(f"_l{lag}")
        l = l.rename(columns={f"player_id_l{lag}": "player_id", f"season_l{lag}": "season"})
        ps = ps.merge(l[["player_id", "season", f"war82_l{lag}", f"bpm_l{lag}"] +
                        ([f"mpg_l{lag}", f"games_share_l{lag}"] if lag == 1 else [])],
                      on=["player_id", "season"], how="left")
    future = ps[["player_id", "season", "war82"]]
    for h in HORIZONS:
        f = future.assign(season=future.season - h).rename(columns={"war82": f"target_h{h}"})
        ps = ps.merge(f, on=["player_id", "season"], how="left")
        observable = ps.season + h <= LAST_FULL_SEASON
        ps.loc[observable & ps[f"target_h{h}"].isna(), f"target_h{h}"] = 0.0  # out of the league
    return ps


def marcel(df: pd.DataFrame, h: int) -> pd.Series:
    """Weighted 5/4/3 average of past WAR, regressed 25% toward 0.5, with a
    simple aging curve (+0.25 WAR/yr before 27, -0.35/yr after 29)."""
    w = np.array([5, 4, 3])
    vals = df[["war82", "war82_l1", "war82_l2"]].to_numpy()
    mask = ~np.isnan(vals)
    avg = np.nansum(vals * w, axis=1) / np.maximum((mask * w).sum(axis=1), 1)
    reg = 0.75 * avg + 0.25 * 0.5
    age_next = df.age + h
    adj = np.where(age_next < 27, 0.25 * h, np.where(age_next > 29, -0.35 * (age_next - 29).clip(upper=h), 0))
    return pd.Series(reg + adj, index=df.index)


def fit_models(train: pd.DataFrame, h: int) -> dict[str, HistGradientBoostingRegressor]:
    y = train[f"target_h{h}"]
    models = {}
    for name, kw in {"p50": dict(loss="quantile", quantile=0.5),
                     "p10": dict(loss="quantile", quantile=0.1),
                     "p90": dict(loss="quantile", quantile=0.9)}.items():
        m = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.04, max_leaf_nodes=24,
                                          min_samples_leaf=40, l2_regularization=1.0, random_state=7, **kw)
        m.fit(train[FEATURES], y)
        models[name] = m
    return models


def build() -> None:
    con = connect()
    ps = player_seasons(con)
    df = panel(ps)
    df = df[df.mp >= 200]  # enough minutes for the stat line to mean something
    metrics, preds = {}, []
    for h in HORIZONS:
        tgt = f"target_h{h}"
        labeled = df[df[tgt].notna()]
        train = labeled[labeled.season + h < TEST_FROM]
        test = labeled[labeled.season + h >= TEST_FROM]
        # Conformalized quantile regression: fit on older seasons, measure how
        # far outcomes fall outside the interval on the two most recent training
        # seasons, and widen every interval by that amount.
        proper = train[train.season + h < TEST_FROM - 2]
        calib = train[train.season + h >= TEST_FROM - 2]
        qhat = conformal_margin(fit_models(proper, h), calib, h)
        models = fit_models(train, h)
        p50 = models["p50"].predict(test[FEATURES])
        p10 = models["p10"].predict(test[FEATURES]) - qhat
        p90 = models["p90"].predict(test[FEATURES]) + qhat
        base_last = test.war82.to_numpy()
        base_marcel = marcel(test, h).to_numpy()
        y = test[tgt].to_numpy()
        metrics[f"h{h}"] = {
            "n_train": int(len(train)), "n_test": int(len(test)),
            "mae_model": round(mean_absolute_error(y, p50), 3),
            "mae_last_season": round(mean_absolute_error(y, base_last), 3),
            "mae_marcel": round(mean_absolute_error(y, base_marcel), 3),
            "r2_model": round(r2_score(y, p50), 3),
            "r2_marcel": round(r2_score(y, base_marcel), 3),
            "interval_coverage_80": round(float(np.mean((y >= p10) & (y <= p90))), 3),
            "conformal_margin_war": round(float(qhat), 3),
        }
        # Refit on everything labeled, then project from the latest full season.
        final = fit_models(labeled, h)
        now = df[df.season == LAST_FULL_SEASON]
        out = now[["player_id", "season"]].copy()
        out["horizon"] = h
        out["target_season"] = LAST_FULL_SEASON + h
        for q, m in final.items():
            out[f"war_{q}"] = m.predict(now[FEATURES])
        out["war_p10"] -= qhat
        out["war_p90"] += qhat
        preds.append(out)
        print(f"  h={h}: MAE model {metrics[f'h{h}']['mae_model']} vs marcel {metrics[f'h{h}']['mae_marcel']}"
              f" vs last-season {metrics[f'h{h}']['mae_last_season']}; 80% coverage {metrics[f'h{h}']['interval_coverage_80']}")
    proj = pd.concat(preds, ignore_index=True)
    # Quantile models are fit separately; enforce p10 <= p50 <= p90.
    q = np.sort(proj[["war_p10", "war_p50", "war_p90"]].to_numpy(), axis=1)
    proj[["war_p10", "war_p50", "war_p90"]] = q
    write(con, "model.projections", proj)
    importances = permutation_summary(df, HORIZONS[0])
    (PROCESSED / "projection_metrics.json").write_text(json.dumps(
        {"metrics": metrics, "features": FEATURES, "top_features": importances}, indent=2))
    con.close()


def conformal_margin(models, calib: pd.DataFrame, h: int, alpha: float = 0.2) -> float:
    y = calib[f"target_h{h}"].to_numpy()
    lo = models["p10"].predict(calib[FEATURES])
    hi = models["p90"].predict(calib[FEATURES])
    scores = np.maximum(lo - y, y - hi)
    n = len(scores)
    return float(np.quantile(scores, min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)))


def permutation_summary(df: pd.DataFrame, h: int) -> list[dict]:
    from sklearn.inspection import permutation_importance
    tgt = f"target_h{h}"
    labeled = df[df[tgt].notna()]
    train = labeled[labeled.season + h < TEST_FROM]
    test = labeled[labeled.season + h >= TEST_FROM]
    m = fit_models(train, h)["p50"]
    r = permutation_importance(m, test[FEATURES], test[tgt], n_repeats=5, random_state=7,
                               scoring="neg_mean_absolute_error")
    order = np.argsort(-r.importances_mean)
    return [{"feature": FEATURES[i], "importance": round(float(r.importances_mean[i]), 4)} for i in order[:10]]


if __name__ == "__main__":
    build()
