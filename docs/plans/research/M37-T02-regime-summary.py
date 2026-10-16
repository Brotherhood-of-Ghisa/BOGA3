"""Summarize the predeclared full cells, counting unresolved fits as failures."""
import json, math, sys
from pathlib import Path
root = Path(sys.argv[1])
matching = ['constant', 'linear', 'quadratic', 'step5', 'step10', 'small-step']
scenarios = matching + ['noise-shift','accuracy-shift','asymmetric','wide','false-zero','serial','session-fatigue','missing','sparse','gap','zero-only','one-only','high-reps','rounding','tau-boundary','p-zero','p-one','late-break','weekly']
def read(phase, name):
    data = json.loads((root / f'{phase}-{name}.json').read_text())
    assert not data['quick']
    assert data['replications'] == (400 if name in matching else 200)
    assert len(data['rows']) == 2 * data['replications']
    return data
cells = {(phase, name): read(phase, name) for phase, names in [('calibration', matching), ('evaluation', scenarios), ('confirmation', matching), ('holdout', matching)] for name in names}
calibration_seeds = {r['seed'] for (p, _), c in cells.items() if p == 'calibration' for r in c['rows']}
evaluation_seeds = {r['seed'] for (p, _), c in cells.items() if p == 'evaluation' for r in c['rows']}
confirmation_seeds = {r['seed'] for (p, _), c in cells.items() if p == 'confirmation' for r in c['rows']}
assert calibration_seeds.isdisjoint(evaluation_seeds)
holdout_seeds = {r['seed'] for (p, _), c in cells.items() if p == 'holdout' for r in c['rows']}
assert confirmation_seeds.isdisjoint(calibration_seeds | evaluation_seeds)
assert holdout_seeds.isdisjoint(calibration_seeds | evaluation_seeds | confirmation_seeds)
def quantile(values, probability=.95):
    return sorted(values)[min(len(values)-1, math.ceil((len(values)+1)*probability)-1)]
def tolerance_quantile(values, probability=.95, family_count=22):
    # Simultaneous finite-calibration confidence via exact binomial order statistics.
    n=len(values); target=1-.05/family_count
    masses=[math.exp(math.lgamma(n+1)-math.lgamma(j+1)-math.lgamma(n-j+1)
        +j*math.log(probability)+(n-j)*math.log1p(-probability)) for j in range(n+1)]
    for rank in range(1,n+1):
        if math.fsum(masses[:rank]) >= target: return sorted(values)[rank-1]
    return math.inf
assert tolerance_quantile(list(range(400))) == 391
assert math.isinf(tolerance_quantile(list(range(10))))
def rate(count, total):
    p=count/total
    z=1.959963984540054; den=1+z*z/total
    center=(p+z*z/(2*total))/den
    half=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/den
    return {'count': count, 'total': total, 'rate': p, 'mcse': math.sqrt(p*(1-p)/total),
        'wilson95': [max(0,center-half), min(1,center+half)]}
assert rate(0,200)['wilson95'][1] > .018
assert abs(rate(20,400)['mcse']-math.sqrt(.05*.95/400)) < 1e-15
def within_bound(error,bound):
    return math.isfinite(error) and math.isfinite(bound) and error <= bound
assert not within_bound(math.inf,math.inf)
assert not within_bound(1,math.inf)
assert within_bound(1,2)
def latest(row): return row['fits'][-1]
def maximum(row): return max(f['usableEvidence'] for f in row['fits'])
def rows(phase, name, method): return [r for r in cells[(phase, name)]['rows'] if r['method'] == method]
def diagnostic_errors(row):
    fit=latest(row); candidate=fit['candidate']; truth=row['truth']
    if fit['status'] != 'fitted' or not candidate: return (math.inf, math.inf, math.inf)
    before, after=candidate['strengths']
    strength=max(abs(before-truth['before']),abs(after-truth['after']))
    effect=abs(after-before-truth['delta'])
    true_cut=[c for c in fit['profile'] if c['left'] <= truth['boundary'][0] and c['right'] >= truth['boundary'][1]]
    drop=math.inf if not true_cut else max(0, 2*(candidate['logLikelihood']-max(c['logLikelihood'] for c in true_cut)))
    return strength,effect,drop
policies={}
for method in ['fixed','joint']:
    cutoff=max(quantile([maximum(r) for r in rows('calibration',name,method)]) for name in matching[:3])
    radii=[max(tolerance_quantile([diagnostic_errors(r)[i] for r in rows('calibration',name,method)])
        for name in (['constant','small-step','step5','step10'] if i < 2 else ['small-step','step5','step10'])) for i in range(3)]
    policies[method]={'searchCutoff':cutoff,'strengthRadiusKg':radii[0],'effectRadiusKg':radii[1],'cutProfileDrop':radii[2],
        'intervalCalibration':'95% content, simultaneous95% calibration confidence across22 component/family references; rank392/400.',
        'emphasisRule':'D/(D+searchCutoff), with D>=0; readable baseline style even at zero. Not a probability.',
        'intervalScope':'Latest32 constant/step2/step5/step10 matching strength/effect design; step2/step5/step10 date profiles. No joint strength/effect/date/nuisance region.'}
summary=[]
for name in scenarios:
    for method in ['fixed','joint']:
        group=rows('holdout' if name in matching else 'evaluation',name,method); policy=policies[method]; n=len(group)
        final=[latest(r) for r in group]; valid=[f['status']=='fitted' for f in final]
        errors=[diagnostic_errors(r) for r in group]
        flag=sum(maximum(r)>policy['searchCutoff'] for r in group)
        effects=[f['candidate']['strengths'][1]-f['candidate']['strengths'][0]-r['truth']['delta'] for f,r,v in zip(final,group,valid) if v and f['candidate']]
        # No-break cells have no true date or two-plateau estimand.
        changed=name in ['step5','step10','small-step','late-break']
        plateau_truth=name not in ['linear','quadratic']
        strength_errors=[s-truth for f,r,v in zip(final,group,valid) if v and f['candidate']
            for s,truth in zip(f['candidate']['strengths'],[r['truth']['before'],r['truth']['after']])]
        widths=[]
        if math.isfinite(policy['cutProfileDrop']):
            for f,v in zip(final,valid):
                if not v or not f['candidate']: continue
                region=[c for c in f['profile'] if 2*(f['candidate']['logLikelihood']-c['logLikelihood']) <= policy['cutProfileDrop']]
                if region: widths.append(max(c['right'] for c in region)-min(c['left'] for c in region))
        summary.append({'scenario':name,'method':method,'searchFlag':rate(flag,n),
            'unresolvedLatest':rate(sum(not v for v in valid),n),
            'anyPrefixWarning':rate(sum(any(f['status']!='fitted' for f in r['fits']) for r in group),n),
            'strengthPairBiasConditionalKg':sum(strength_errors)/len(strength_errors) if strength_errors and plateau_truth else None,
            'strengthPairRmseConditionalKg':math.sqrt(sum(e*e for e in strength_errors)/len(strength_errors)) if strength_errors and plateau_truth else None,
            'meanDateEnvelopeWidthTimeUnits':sum(widths)/len(widths) if widths else None,
            'meanSearchedFits':sum(sum(f['fits'] for f in r['fits']) for r in group)/n,
            'effectRmseConditionalKg':math.sqrt(sum(e*e for e in effects)/len(effects)) if effects and plateau_truth else None,
            'strengthCoverage':rate(sum(v and within_bound(e[0],policy['strengthRadiusKg']) for v,e in zip(valid,errors)),n) if plateau_truth and math.isfinite(policy['strengthRadiusKg']) else None,
            'effectCoverage':rate(sum(v and within_bound(e[1],policy['effectRadiusKg']) for v,e in zip(valid,errors)),n) if plateau_truth and math.isfinite(policy['effectRadiusKg']) else None,
            'dateProfileCoverage':rate(sum(v and within_bound(e[2],policy['cutProfileDrop']) for v,e in zip(valid,errors)),n) if changed and math.isfinite(policy['cutProfileDrop']) else None,
            'jointPEndpoints':rate(sum(v and f['candidate']['p'] is not None and min(f['candidate']['p'],1-f['candidate']['p'])<1e-5 for f,v in zip(final,valid)),n) if method=='joint' else None,
            'uninformedP':rate(sum(f['candidate'] is not None and f['candidate']['p'] is None for f in final),n)})
assert len(summary)==50
# JSON infinities are explicit unsupported intervals, never silently finite numbers.
def finite(x):
    if isinstance(x,float) and not math.isfinite(x): return 'unresolved'
    if isinstance(x,dict): return {k:finite(v) for k,v in x.items()}
    if isinstance(x,list): return list(map(finite,x))
    return x
print(json.dumps(finite({'schema':'strength-regime-summary.v1','syntheticHistories':len(calibration_seeds)+len(evaluation_seeds)+len(confirmation_seeds)+len(holdout_seeds),
    'phases':{'calibration':len(calibration_seeds),'discoveryEvaluation':len(evaluation_seeds),'developmentConfirmation':len(confirmation_seeds),'freshHoldout':len(holdout_seeds)},
    'policies':policies,'cells':summary,'limits':'Conditional simulation family only. Raw likelihood is not a posterior probability. Unresolved cases remain in denominators; no-cut cells abstain. No arbitrary continuous monitoring guarantee.'}),indent=2))
