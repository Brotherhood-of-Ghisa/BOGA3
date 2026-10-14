"""Scientific research plots from kernel-produced coordinates; no RM formula here."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

folder = Path(sys.argv[1])
strength = json.loads((folder / 'strength-results.json').read_text())
regression = json.loads((folder / 'regression-results.json').read_text())
assert not strength['design']['quick'] and not regression['design']['quick']
find = lambda name: next(e for e in strength['experiments'] if e['scenario']['name'] == name)
example = find('matched-n24-sigma1')['example']
colors = {'truth': '#263238', 'fixed': '#176bba', 'joint': '#ba5717'}
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})

fig, axes = plt.subplots(1, 3, figsize=(15, 4.8), constrained_layout=True)
curve = example['curve']
for key, label in [('truth', 'True 1RM = 100 kg'), ('fixed', f"Fixed σ = 1; 1RM = {example['fixed']['estimate']:.1f}"),
                   ('joint', f"Joint: 1RM = {example['joint']['estimate']:.1f}, σ = {example['sigmaProfile']['estimate']:g}")]:
    axes[0].plot([c['reps'] for c in curve], [c[key] for c in curve], label=label, color=colors[key],
                 linestyle='--' if key == 'truth' else '-', linewidth=2)
points = example['points']
scatter = axes[0].scatter([[2, 4, 6][i % 3] + p['recordedRir'] for i, p in enumerate(points)],
                         [p['load'] for p in points], c=np.arange(1, len(points) + 1), cmap='viridis', s=24, alpha=.8)
fig.colorbar(scatter, ax=axes[0], label='Session (earlier → later)')
axes[0].set(xlabel='Recorded RIR0-equivalent reps (m + n)', ylabel='Total load (kg)', title='Same adopted curve; only 1RM changes')
axes[0].legend(fontsize=8)
grid = np.array(example['grid'], dtype=float)
axis = np.array(strength['design']['strengths'])
sigmas = np.array(strength['design']['sigmas'])
fixed = grid[list(sigmas).index(1)]
profile = np.nanmax(grid, axis=0)
axes[1].plot(axis, 2 * (np.max(fixed) - fixed), color=colors['fixed'], label='Fixed RIR σ = 1')
axes[1].plot(axis, 2 * (np.max(profile) - profile), color=colors['joint'], label='Joint, profiled over σ')
axes[1].axvline(100, color=colors['truth'], linestyle='--', label='True 1RM')
axes[1].set(xlim=(97, 103), ylim=(0, 15), xlabel='1RM amplitude S (kg)', ylabel='Relative likelihood loss, 2ΔlogL',
            title='Uncertainty concerns the curve amplitude')
axes[1].legend(fontsize=8)
loss = 2 * (np.nanmax(grid) - grid)
mesh = axes[2].pcolormesh(axis, sigmas, np.ma.masked_invalid(loss), cmap='viridis_r', shading='auto', vmin=0, vmax=15)
axes[2].plot([100], [1], marker='+', markersize=13, color='white', label='Truth')
best = np.unravel_index(np.nanargmax(grid), grid.shape)
axes[2].plot([axis[best[1]]], [sigmas[best[0]]], marker='o', markersize=7, markerfacecolor='none',
             markeredgecolor=colors['joint'], markeredgewidth=2, label='Joint optimum')
axes[2].axhline(1, color='white', linestyle=':', linewidth=1, label='Fixed σ path')
axes[2].set(xlim=(96, 104), ylim=(0, 3), xlabel='1RM amplitude S (kg)', ylabel='RIR error σ (reps)',
            title='Joint fit: measurement σ, fixed curve shape')
axes[2].legend(fontsize=8, facecolor='#666666', labelcolor='white')
fig.colorbar(mesh, ax=axes[2], label='Relative likelihood loss (not a confidence region)')
fig.suptitle('Two statistical approaches · one synthetic history · 24 independent sessions\nIllustrative fit under the declared model, not evidence of real-world calibration', fontsize=13)
fig.savefig(folder / 'two-statistical-approaches.png', dpi=160)
plt.close(fig)

fig, axes = plt.subplots(2, 2, figsize=(12, 8), constrained_layout=True)
counts = strength['design']['counts']
for method, label, color in [('fixed-1', 'Fixed σ = 1', colors['fixed']), ('joint', 'Joint S / σ', colors['joint'])]:
    results = [find(f'matched-n{n}-sigma1')['methods']['first'][method] for n in counts]
    axes[0, 0].errorbar(counts, [r['conditionalRmse'] for r in results],
                        yerr=[r['rmseMonteCarloSe'] for r in results], label=label, color=color, marker='o', capsize=3)
axes[0, 0].set(xlabel='Independent sessions', ylabel='1RM recovery RMSE (kg)', title='Matched noise: both recover S')
axes[0, 0].legend()
names = ['matched-n24-sigma1', 'load-discrepancy-understated', 'high-latent-rir-prior', 'plate-rounded-2.5kg', 'serial-reporting-error']
labels = ['Matched', 'Load noise\nunderstated', 'Wrong RIR\nprior', 'Plate\nrounding', 'Serial RIR\nerror']
x = np.arange(len(names))
for offset, method, label, color in [(-.14, 'fixed-1', 'Fixed σ = 1', colors['fixed']), (.14, 'joint', 'Joint S / σ', colors['joint'])]:
    rates = [find(n)['methods']['first'][method]['unconditionalCoverage'] for n in names]
    axes[0, 1].errorbar(x + offset, [r['fraction'] * 100 for r in rates], yerr=[r['monteCarloSe'] * 100 for r in rates],
                        fmt='o', color=color, label=label, capsize=3)
axes[0, 1].axhline(95, linestyle=':', color='#555555')
axes[0, 1].set(xticks=x, xticklabels=labels, ylim=(30, 102), ylabel='Observed interval coverage (%)',
               title='Uncertainty fails when assumptions fail')
get = lambda name: next(e for e in regression['experiments'] if e['scenario']['name'] == name)
null_names = ['constant-n48', 'linear-n48', 'quadratic-n48', 'constant-serial', 'constant-dependence']
rates = [get(n)['anyPrefixDetection'] for n in null_names]
axes[1, 0].bar(np.arange(len(rates)), [r['fraction'] * 100 for r in rates], color=['#5c8076'] * 3 + ['#ac4c4c'] * 2,
                yerr=[r['monteCarloSe'] * 100 for r in rates], capsize=3)
naive = get('constant-dependence')['naiveSetDetection']
axes[1, 0].bar(5, naive['fraction'] * 100, color='#ac4c4c', yerr=naive['monteCarloSe'] * 100, capsize=3)
axes[1, 0].axhline(5, linestyle=':', color='#555555')
axes[1, 0].set(xticks=range(6), xticklabels=['Stable', 'Linear', 'Smooth', 'Serial\nerrors', 'Session\nmedians', 'Naive\nsets'],
               ylabel='False break flags (%)', title='Full search calibrated only for independent sessions')
for model, effect, label, color in [('jump', 5, '+5 kg level change', colors['fixed']), ('hinge', .5, '+0.5 kg/week slope change', colors['joint'])]:
    rates = [get(f'{model}-{effect:g}-n{n}')['anyPrefixDetection'] for n in [16, 24, 48]]
    axes[1, 1].errorbar([16, 24, 48], [r['fraction'] * 100 for r in rates], yerr=[r['monteCarloSe'] * 100 for r in rates],
                       marker='o', color=color, label=label, capsize=3)
axes[1, 1].set(xlabel='Independent sessions', ylabel='Any-prefix detection (%)', ylim=(-3, 103),
               title='Power depends on change size and form')
axes[1, 1].legend(fontsize=9)
fig.suptitle('Research validation · 400 repetitions per matched cell / 200 per stress cell\nBars show one Monte Carlo SE; no production reliability claim', fontsize=13)
fig.savefig(folder / 'statistical-validation.png', dpi=160)
plt.close(fig)
