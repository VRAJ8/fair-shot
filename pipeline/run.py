"""Run the whole pipeline end to end.

    python -m pipeline.run            # parse cache -> warehouse -> models -> tests -> export
    python -m pipeline.run --ingest   # download first (slow the first time; cached after)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

STEPS = [
    ("Parse raw pages", "pipeline.load_raw"),
    ("Build warehouse (SQL + crosswalk)", "pipeline.warehouse"),
    ("Fair value model", "pipeline.models.value"),
    ("Projection model", "pipeline.models.projection"),
    ("Comps", "pipeline.models.comps"),
    ("League stories", "pipeline.models.stories"),
    ("Career survival", "pipeline.models.survival"),
    ("Data-quality checks", "pipeline.validate"),
    ("Export JSON for the site", "pipeline.export"),
    ("Slim database for the AI agent", "pipeline.serve_db"),
]


def main() -> None:
    env = {**os.environ, "FAIRSHOT_OFFLINE": "1"}
    if "--ingest" in sys.argv:
        for source in ("espn", "bbref"):
            subprocess.run([sys.executable, "-m", "pipeline.ingest", source], check=True)
    t0 = time.time()
    for i, (name, module) in enumerate(STEPS, 1):
        print(f"\n[{i}/{len(STEPS)}] {name}", flush=True)
        r = subprocess.run([sys.executable, "-m", module], env=env)
        if r.returncode != 0:
            sys.exit(f"Step failed: {name}. Fix it and re-run; earlier steps are cached.")
    print(f"\nPipeline finished in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
