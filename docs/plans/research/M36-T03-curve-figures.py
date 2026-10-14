"""Render local scientific diagnostics from the adopted-kernel analysis output."""
import json
import math
from pathlib import Path
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

source = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
data = json.loads(source.read_text())
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, axes = plt.subplots(2, 3, figsize=(15, 8), constrained_layout=True)
order = ["stable", "plateau", "gradual"]
colours = plt.get_cmap("viridis")
for column, name in enumerate(order):
    scenario = next(s for s in data["synthetic"] if s["name"] == name)
    prefixes, observed = scenario["prefixes"], scenario["observations"]
    assert len(prefixes) == 24 and len(observed) == 72
    top, bottom = axes[:, column]
    top.scatter([p["u"] for p in observed], [p["weight"] for p in observed],
                color="#7a7a7a", alpha=.35, s=28, label="Observed sets, all 24 weeks")
    for week in [4, 8, 12, 16, 20, 24]:
        curve = prefixes[week - 1]["curves"]
        assert all(math.isfinite(p["linear"]) for p in curve)
        top.plot([p["reps"] for p in curve], [p["linear"] for p in curve],
                 color=colours((week - 4) / 20), label=f"Through week {week}")
    curve = prefixes[-1]["curves"]
    top.plot([p["reps"] for p in curve], [p["reference"] for p in curve],
             "--", color="black", linewidth=1.6, label="Fixed prior reference")
    top.set(title=name.title() + " — synthetic", xlabel="RIR0-equivalent repetitions", ylabel="Load (kg)", xlim=(1, 12))
    top.grid(alpha=.16)
    responses = scenario["analysis"]["main"]["sessionResponses"]
    bottom.scatter(range(1, 25), [100 * (1 + r["value"] / 100) for r in responses],
                   color="#777777", s=24, label="Session median analytical RM")
    bottom.plot(range(1, 25), [p["linearRm"] for p in prefixes], color="#236e8a", label="Linear fit at current week")
    bottom.plot(range(1, 25), [p["constantRm"] for p in prefixes], color="#c87930", label="Constant fit")
    bottom.axhline(100, color="black", linestyle="--", label="Fixed prior reference")
    bottom.set(xlabel="Completed week", ylabel="Analytical RM level (kg)", xlim=(1, 24))
    bottom.grid(alpha=.16)
axes[0, 0].legend(fontsize=8, loc="lower left")
axes[1, 0].legend(fontsize=8, loc="upper left")
fig.suptitle("Research: evolving RM levels, unchanged BoGa curve shape\nFits use completed weekly prefixes only; no calibrated uncertainty", fontsize=14)
fig.savefig(out / "synthetic-curves.png", dpi=160)
plt.close(fig)

if "cohorts" in data["remote"]:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5), constrained_layout=True)
    names = data["remote"]["provenance"]["exerciseNames"]
    assert len(names) == 2
    for ax, (exercise, title) in zip(axes, names.items()):
        group = max((g for g in data["remote"]["cohorts"] if g["scope"]["exercise"] == exercise), key=lambda g: g["rawSets"])
        points = group["main"]["plotPoints"]
        ax.scatter([p["equivalentReps"] for p in points], [p["load"] for p in points],
                   s=48, facecolors="none", edgecolors="#236e8a", label="Later qualifying sets")
        ref = group["reference"]
        if ref["rm"] is None:
            ax.text(.04, .08, f"No reference: {ref['qualifyingSessions']} prior sessions; 6 required", transform=ax.transAxes)
        else:
            # Reuse kernel-supplied unit-load multipliers from the synthetic reference100 curve.
            curve = data["synthetic"][0]["prefixes"][0]["curves"]
            factor = points[0]["factor"]
            ax.plot([p["reps"] for p in curve], [ref["rm"] * p["reference"] / (100 * factor) for p in curve],
                    color="black", linestyle="--", label="Independent prior reference")
        ax.set(title=title + " — main same-gym cohort", xlabel="RIR0-equivalent repetitions",
               ylabel="Load (kg in exercise entry mode)")
        ax.grid(alpha=.16)
        ax.legend(fontsize=8)
    fig.suptitle("Authorised remote history — descriptive comparison\nRecorded/imported effort provenance remains a limitation", fontsize=13)
    fig.savefig(out / "remote-curves-private.png", dpi=160)
    plt.close(fig)
