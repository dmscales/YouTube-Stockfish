#!/usr/bin/env python3
"""Fit the survival model to real retention you've logged, and measure whether
it beats a duration-only baseline on videos it has never seen.

    python3 worker/train.py            # evaluate + fit + write data/model_params.json
    python3 worker/train.py --dry-run  # evaluate only

Uses every data/videos/<id>/ that has both analysis.json and feedback.json
with a retention curve or an average-viewed figure.

Cross-validation holds out whole channels (meta.channel) when there are at
least 2, otherwise single videos, so the model can't score well just by
memorizing one creator's style.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import audience  # noqa: E402
import predict  # noqa: E402

TRAINABLE = predict.ALL_SIGNALS
L2 = 0.5          # pull toward the hand-set defaults; data has to earn deviations
MIN_VIDEOS = 3


def load_examples(root: Path) -> list[dict]:
    ex = []
    for d in sorted((root / "videos").glob("*")):
        try:
            meta = json.loads((d / "meta.json").read_text())
            an = json.loads((d / "analysis.json").read_text())
            fb = json.loads((d / "feedback.json").read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        pts = [(float(t), min(100.0, max(0.0, float(p))) / 100) for t, p in fb.get("retention") or []]
        avg = fb.get("avg_viewed_pct")
        if not pts and avg is None:
            continue
        ex.append({
            "id": d.name,
            "group": meta.get("channel") or "default",
            "duration": an["video"]["duration"],
            "signals": an["signals"],
            "mix": audience.mix_vector((meta.get("audience") or {}).get("preset", "feed"),
                                       (meta.get("audience") or {}).get("mix")),
            "points": pts,
            "avg": None if avg is None else float(avg) / 100,
        })
    return ex


def errors(params: dict, e: dict, draws: bool = False) -> dict:
    sim = predict.simulate(e["signals"], e["duration"], e["mix"], params, draws=draws)
    out = {"avg_err": None, "curve_mae": None, "coverage": None}
    if e["avg"] is not None:
        out["avg_err"] = abs(sim["avg_viewed"] - e["avg"])
    if e["points"]:
        grid = np.arange(len(sim["curve"]))
        ts = np.array([p[0] for p in e["points"]])
        ys = np.array([p[1] for p in e["points"]])
        pred = np.interp(ts, grid, sim["curve"])
        out["curve_mae"] = float(np.mean(np.abs(pred - ys)))
        if draws:
            lo = np.interp(ts, grid, sim["curve_p10"])
            hi = np.interp(ts, grid, sim["curve_p90"])
            out["coverage"] = float(np.mean((ys >= lo) & (ys <= hi)))
    return out


def objective(params: dict, exs: list[dict]) -> float:
    total = 0.0
    for e in exs:
        er = errors(params, e)
        if er["curve_mae"] is not None:
            total += er["curve_mae"] ** 2 * 4
        if er["avg_err"] is not None:
            total += er["avg_err"] ** 2 * 4
    return total / max(1, len(exs))


def pack(params: dict, keys: list[str]) -> np.ndarray:
    return np.array([np.log(params["baseline_scale"])] +
                    [np.log(max(params["betas"][k], 1e-3)) for k in keys])


def unpack(base: dict, theta: np.ndarray, keys: list[str]) -> dict:
    p = copy.deepcopy(base)
    p["baseline_scale"] = float(np.exp(theta[0]))
    for k, v in zip(keys, theta[1:]):
        p["betas"][k] = float(np.exp(v))
    return p


def fit(base: dict, exs: list[dict], iters: int = 150, freeze_betas: bool = False) -> dict:
    keys = [] if freeze_betas else [k for k in TRAINABLE if any(k in e["signals"] for e in exs)]
    theta0 = pack(base, keys)
    theta = theta0.copy()
    m = np.zeros_like(theta)
    v = np.zeros_like(theta)
    lr, eps = 0.05, 1e-3

    def f(th):
        return objective(unpack(base, th, keys), exs) + L2 * 0.01 * float(np.sum((th - theta0) ** 2))

    for i in range(1, iters + 1):
        g = np.zeros_like(theta)
        f0 = f(theta)
        for j in range(len(theta)):
            th = theta.copy()
            th[j] += eps
            g[j] = (f(th) - f0) / eps
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        theta -= lr * (m / (1 - 0.9 ** i)) / (np.sqrt(v / (1 - 0.999 ** i)) + 1e-8)
    return unpack(base, theta, keys)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(float(np.mean(xs)), 4) if xs else None


def cross_validate(defaults: dict, exs: list[dict]) -> dict:
    groups = sorted({e["group"] for e in exs})
    by = "channel" if len(groups) >= 2 else "video"
    folds = groups if by == "channel" else [e["id"] for e in exs]
    rows = []
    baseline_only = copy.deepcopy(defaults)
    baseline_only["betas"] = {k: 0.0 for k in defaults["betas"]}
    for f in folds:
        test = [e for e in exs if (e["group"] if by == "channel" else e["id"]) == f]
        train = [e for e in exs if e not in test]
        trained = fit(defaults, train, iters=80)
        base_fit = fit(baseline_only, train, iters=60, freeze_betas=True)
        for e in test:
            rows.append({
                "id": e["id"],
                "heuristic": errors(defaults, e),
                "trained": errors(trained, e, draws=True),
                "baseline": errors(base_fit, e),
            })
    summary = {}
    for name in ("heuristic", "trained", "baseline"):
        summary[name] = {
            "curve_mae_pp": None if mean([r[name]["curve_mae"] for r in rows]) is None
            else round(mean([r[name]["curve_mae"] for r in rows]) * 100, 2),
            "avg_viewed_err_pp": None if mean([r[name]["avg_err"] for r in rows]) is None
            else round(mean([r[name]["avg_err"] for r in rows]) * 100, 2),
        }
    summary["trained"]["band_coverage"] = mean([r["trained"]["coverage"] for r in rows])
    t, b = summary["trained"], summary["baseline"]
    key = "curve_mae_pp" if t["curve_mae_pp"] is not None else "avg_viewed_err_pp"
    improvement = None
    if t[key] is not None and b[key]:
        improvement = round((b[key] - t[key]) / b[key] * 100, 1)
    return {"holdout": by, "folds": len(folds), "summary": summary, "metric": key,
            "improvement_over_baseline_pct": improvement,
            "beats_target": improvement is not None and improvement >= 20, "per_video": rows}


def calibrate_bands(params: dict, exs: list[dict]) -> dict:
    """Scale the uncertainty so the p10-p90 band covers about 80% of real points."""
    with_pts = [e for e in exs if e["points"]]
    if not with_pts:
        return params
    best, best_gap = params, 9.0
    for s in (0.5, 0.75, 1.0, 1.5, 2.0, 3.0):
        p = copy.deepcopy(params)
        p["uncertainty"]["beta_sigma"] = params["uncertainty"]["beta_sigma"] * s
        p["uncertainty"]["baseline_sigma"] = params["uncertainty"]["baseline_sigma"] * s
        cov = mean([errors(p, e, draws=True)["coverage"] for e in with_pts])
        if cov is not None and abs(cov - 0.8) < best_gap:
            best, best_gap = p, abs(cov - 0.8)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    root = predict.data_dir()
    defaults = json.loads((predict.HERE / "model_defaults.json").read_text())
    exs = load_examples(root)
    report = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "n_videos": len(exs)}
    if len(exs) < MIN_VIDEOS:
        report["status"] = "not_enough_data"
        report["message"] = f"Need real retention for at least {MIN_VIDEOS} analyzed videos (have {len(exs)})."
        (root / "model_report.json").write_text(json.dumps(report, indent=2))
        print(report["message"])
        return

    report["cv"] = cross_validate(defaults, exs)
    if not args.dry_run:
        prev = predict.load_params()
        n = int(str(prev.get("version", "v0")).rsplit("v", 1)[-1]) + 1 if prev.get("trained") else 1
        params = fit(defaults, exs)
        params = calibrate_bands(params, exs)
        params.update({"version": f"trained-v{n}", "trained": True, "n_videos": len(exs),
                       "trained_at": report["created_at"],
                       "notes": "Fitted to creator-logged retention. See model_report.json for holdout accuracy."})
        (root / "model_params.json").write_text(json.dumps(params, indent=2))
        report["model_version"] = params["version"]
    report["status"] = "ok"
    (root / "model_report.json").write_text(json.dumps(report, indent=2))
    s = report["cv"]["summary"]
    print(json.dumps({k: s[k] for k in s}, indent=2))
    print("improvement over baseline (%):", report["cv"]["improvement_over_baseline_pct"])


if __name__ == "__main__":
    main()
