import argparse
import bisect
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import pymeshlab
from mesh_fitting import forearm_fitter, erector_envelopes, surface_envelopes

folder = Path(__file__).resolve().parent
mobile = folder.parents[1]
parser = argparse.ArgumentParser(description='Bake the pinned triangle meshes and fitted envelopes for the native wireframe view.')
parser.add_argument('--source-dir', type=Path, default=mobile / 'artifacts/muscle-body-anatomy/source')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
cache = args.source_dir
manifest = json.loads((folder / 'mesh-source.json').read_text())
body_bytes = (mobile / 'components/stats/muscle-body-mesh.json').read_bytes()
assert hashlib.sha256(body_bytes).hexdigest() == manifest['bodyMeshSha256']
body = json.loads(body_bytes)
catalog = [json.loads(row) for row in re.findall(r'\{"id":.*?\}', (mobile / 'components/stats/muscle-map-reference.ts').read_text())]
groups = manifest['groups']
def obj(part):
    path = cache / f'{part}.obj'
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == manifest['sources']['models'][part]['sha256'], part
    vertices, faces = [], []
    for line in raw.decode().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'v':
            vertices.append([float(n) for n in fields[1:4]])
        elif fields[0] == 'f':
            indices = [int(n.split('/')[0]) - 1 for n in fields[1:]]
            faces.extend([[indices[0], indices[i], indices[i + 1]] for i in range(1, len(indices) - 1)])
    return vertices, faces

def dot(a, b): return sum(x * y for x, y in zip(a, b))
def sub(a, b): return [x - y for x, y in zip(a, b)]
def unit(a):
    length = math.sqrt(dot(a, a))
    return [n / length for n in a]
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def frame(axis, outward, front):
    axis = unit(axis)
    outward = unit(sub(outward, [dot(outward, axis) * n for n in axis]))
    front = unit(sub(sub(front, [dot(front, axis) * n for n in axis]), [dot(front, outward) * n for n in outward]))
    return [outward, axis, front]
def bounds(points): return [[min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)]]
def interp(value, xs, ys):
    i = bisect.bisect_right(xs, value)
    if i == 0: return ys[0]
    if i == len(xs): return ys[-1]
    return ys[i - 1] + (ys[i] - ys[i - 1]) * (value - xs[i - 1]) / (xs[i] - xs[i - 1])

def bone_transform(bone):
    r = manifest['registration'][bone]
    source, target = r['sourceProximal'], r['targetProximal']
    source_basis = frame(sub(r['sourceDistal'], source), [-1, 0, 0], [0, -1, 0])
    target_basis = frame(sub(r['targetDistal'], target), [1, 0, 0], [0, 0, 1])
    def transform(p):
        local = [dot(sub(p, source), a) for a in source_basis]
        return [target[k] + r['uniformScale'] * sum(local[j] * target_basis[j][k] for j in range(3)) for k in range(3)]
    return transform

def section_profiles(vertices, faces, levels, axis):
    graphs = [{} for _ in levels]
    for face in faces:
        triangle = [vertices[i] for i in face[:3]]
        low, high = min(p[axis] for p in triangle), max(p[axis] for p in triangle)
        for level_index in range(bisect.bisect_left(levels, low), bisect.bisect_left(levels, high)):
            level, hits = levels[level_index], []
            for a, b in [(0, 1), (1, 2), (2, 0)]:
                p, q = triangle[a], triangle[b]
                if (p[axis] < level) == (q[axis] < level): continue
                t = (level - p[axis]) / (q[axis] - p[axis])
                hits.append(tuple(round(p[k] + (q[k] - p[k]) * t, 4) for k in range(3)))
            if len(hits) == 2:
                graph = graphs[level_index]
                graph.setdefault(hits[0], set()).add(hits[1])
                graph.setdefault(hits[1], set()).add(hits[0])
    result = []
    for graph in graphs:
        unseen, parts = set(graph), []
        while unseen:
            todo, part = [unseen.pop()], []
            while todo:
                point = todo.pop(); part.append(point)
                for neighbor in graph[point] & unseen:
                    unseen.remove(neighbor); todo.append(neighbor)
            if len(part) >= 4: parts.append(part)
        central = [part for part in parts if min(p[0] for p in part) < 0 < max(p[0] for p in part)]
        if not central:
            nearest = min(abs(sum(p[0] for p in part) / len(part)) for part in parts)
            central = [part for part in parts if abs(sum(p[0] for p in part) / len(part)) <= nearest * 1.5]
        result.append(bounds([p for part in central for p in part]))
    return result

print('Registering source geometry…', flush=True)
r = manifest['registration']['torso']
z_levels = [700 + i * 12.5 for i in range(65)]
y_levels = [interp(z, r['sourceHeights'], r['targetHeights']) for z in z_levels]
skin_vertices, skin_faces = obj('FJ2810')
source_profiles = section_profiles(skin_vertices, skin_faces, z_levels, 2)
target_profiles = section_profiles(body['vertices'], body['faces'], y_levels, 1)
source_widths = [max(abs(lo[0]), abs(hi[0])) for lo, hi in source_profiles]
target_widths = [max(abs(lo[0]), abs(hi[0])) for lo, hi in target_profiles]
source_fronts, source_backs = [[b[side][1] for b in source_profiles] for side in [0, 1]]
target_fronts, target_backs = [[b[side][2] for b in target_profiles] for side in [1, 0]]
def torso(p):
    x, y, z = p
    sx, tx = interp(z, z_levels, source_widths), interp(z, z_levels, target_widths)
    front, back = interp(z, z_levels, source_fronts), interp(z, z_levels, source_backs)
    tf, tb = interp(z, z_levels, target_fronts), interp(z, z_levels, target_backs)
    return [-x * tx / sx, interp(z, r['sourceHeights'], r['targetHeights']), tb + (back - y) / (back - front) * (tf - tb)]

transforms = {'arm': bone_transform('FJ3368'), 'forearm': bone_transform('FJ3349'), 'thigh': bone_transform('FJ3365'), 'leg': bone_transform('FJ3387')}
families = {key: 'torso' for key in groups}
for key in ['brachialis', 'biceps', 'triceps', 'delts_front', 'delts_lateral', 'delts_rear']: families[key] = 'arm'
for key in ['quads', 'hamstrings', 'adductors']: families[key] = 'thigh'
for key in ['calves', 'tibialis_anterior']: families[key] = 'leg'
families['forearms_grip'] = 'forearm'
fit_forearm, _ = forearm_fitter(skin_vertices, skin_faces, body['vertices'], body['faces'], manifest['registration']['FJ3349'], frame, dot, sub)

def weld(vertices, faces):
    unique, lookup, remap = [], {}, {}
    used = sorted({i for face in faces for i in face})
    for i in used:
        point = vertices[i]
        key = tuple(point)
        if key not in lookup:
            lookup[key] = len(unique); unique.append(point)
        remap[i] = lookup[key]
    return unique, [[remap[i] for i in f] for f in faces]

def topology(vertices, faces):
    edges = Counter(tuple(sorted((a, b))) for f in faces for a, b in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])])
    used = {i for f in faces for i in f}
    return len(used) - len(edges) + len(faces), sum(n == 1 for n in edges.values()), sum(n > 2 for n in edges.values())

def components(vertices, faces):
    parent = list(range(len(faces)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    edges = {}
    for i, (a, b, c) in enumerate(faces):
        for p, q in [(a, b), (b, c), (c, a)]:
            edge = tuple(sorted((p, q)))
            if edge in edges: parent[find(i)] = find(edges[edge])
            else: edges[edge] = i
    grouped = defaultdict(list)
    for i, face in enumerate(faces): grouped[find(i)].append(face)
    result = []
    for group in grouped.values():
        used = sorted({i for face in group for i in face})
        remap = {v: i for i, v in enumerate(used)}
        result.append(([vertices[i] for i in used], [[remap[i] for i in face] for face in group]))
    return result

def manifold(faces):
    edges = Counter(tuple(sorted((a, b))) for f in faces for a, b in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])])
    if any(n != 2 for n in edges.values()): return False
    links = defaultdict(lambda: defaultdict(Counter))
    for a, b, c in faces:
        for v, p, q in [(a, b, c), (b, c, a), (c, a, b)]:
            links[v][p][q] += 1; links[v][q][p] += 1
    for link in links.values():
        if any(sum(edges.values()) != 2 for edges in link.values()): return False
        seen, todo = set(), [next(iter(link))]
        while todo:
            point = todo.pop()
            if point in seen: continue
            seen.add(point); todo.extend(set(link[point]) - seen)
        if len(seen) != len(link): return False
    return True

def signed_volume(vertices, faces):
    return sum(dot(vertices[a], cross(vertices[b], vertices[c])) for a, b, c in faces)

def simplify(vertices, faces, budget, constrain=None):
    if len(faces) <= budget: return vertices, faces
    output_vertices, output_faces = [], []
    for points, triangles in components(vertices, faces):
        target = max(24, round(budget * len(triangles) / len(faces)))
        new_points, new_triangles = points, triangles
        original_volume = abs(signed_volume(points, triangles))
        while target < len(triangles):
            mesh_set = pymeshlab.MeshSet()
            mesh_set.add_mesh(pymeshlab.Mesh(np.asarray(points, dtype=np.float64), np.asarray(triangles, dtype=np.int32)))
            mesh_set.meshing_decimation_quadric_edge_collapse(targetfacenum=target, preserveboundary=True, preservenormal=True, preservetopology=True, autoclean=True)
            candidate_points = mesh_set.current_mesh().vertex_matrix().tolist()
            candidate_faces = mesh_set.current_mesh().face_matrix().tolist()
            # Validate the geometry that will ship, after restoring extents and fitting the hand.
            lo, hi = bounds(points); reduced_lo, reduced_hi = bounds(candidate_points)
            candidate_points = [[lo[k] + (p[k] - reduced_lo[k]) * (hi[k] - lo[k]) / (reduced_hi[k] - reduced_lo[k]) if reduced_hi[k] - reduced_lo[k] > 1e-12 else p[k] for k in range(3)] for p in candidate_points]
            if constrain: candidate_points = [constrain(p) for p in candidate_points]
            volume = abs(signed_volume(candidate_points, candidate_faces))
            volume_ok = original_volume < 1e-14 or .85 < volume / original_volume < 1.15
            if manifold(candidate_faces) and topology(candidate_points, candidate_faces) == topology(points, triangles) and len(components(candidate_points, candidate_faces)) == 1 and volume_ok:
                new_points, new_triangles = candidate_points, candidate_faces
                break
            target = max(target + 16, round(target * 1.5))
        final_volume = abs(signed_volume(new_points, new_triangles))
        assert original_volume < 1e-14 or .85 < final_volume / original_volume < 1.15
        offset = len(output_vertices)
        output_vertices.extend(new_points); output_faces.extend([[i + offset for i in f] for f in new_triangles])
    assert topology(output_vertices, output_faces)[1:] == topology(vertices, faces)[1:]
    assert len(components(output_vertices, output_faces)) == len(components(vertices, faces))
    return output_vertices, output_faces

assets = {}
for item in catalog:
    key = item['id']
    if key not in groups:
        material = body['materials'].index(key)
        vertices, faces = weld(body['vertices'], [f[:3] for f in body['faces'] if f[3] == material])
        assets[key] = {'kind': 'surface', 'parts': surface_envelopes(key, vertices, faces, components), 'mirror': False}
        continue
    parts = []
    for part in groups[key]:
        vertices, faces = obj(part)
        transform = torso if families[key] == 'torso' else transforms[families[key]]
        vertices = [transform(p) for p in vertices]
        if part in manifest.get('coverage', {}):
            error = max(abs(a - b) for p, q in zip(bounds(vertices), manifest.get('coverage', {})[part]['sourceBounds']) for a, b in zip(p, q))
            assert error < .000002, (part, error)
        if key == 'forearms_grip': vertices = [fit_forearm(p) for p in vertices]
        vertices, faces = weld(vertices, faces)
        budget = 350 if key == 'forearms_grip' else 500 if key == 'spinal_erectors' else 650
        if key == 'serratus_anterior': budget = 1500
        if key not in ['brachialis', 'spinal_erectors']:
            vertices, faces = simplify(vertices, faces, budget, fit_forearm.constrain if key == 'forearms_grip' else None)
        volume = sum(dot(vertices[a], cross(vertices[b], vertices[c])) for a, b, c in faces)
        if volume < 0: faces = [[a, c, b] for a, b, c in faces]
        parts.append({'id': part, 'vertices': [[round(n, 7) for n in p] for p in vertices], 'faces': faces})
    if key == 'spinal_erectors':
        parts = erector_envelopes(parts)
        for part in parts:
            if signed_volume(part['vertices'], part['faces']) < 0: part['faces'] = [[a, c, b] for a, b, c in part['faces']]
            assert manifold(part['faces']) and topology(part['vertices'], part['faces']) == (2, 0, 0)
    assets[key] = {'kind': 'envelope' if key == 'spinal_erectors' else 'atlas', 'parts': parts, 'mirror': True}
    print(key, sum(len(p['faces']) for p in parts), 'faces', flush=True)


payload = {'schemaVersion': 1, 'bodyMeshSha256': manifest['bodyMeshSha256'], 'catalog': [{'id': x['id'], 'label': x['label'], 'family': x['family']} for x in catalog], 'muscles': assets}
output = mobile / 'components/stats/muscle-anatomy-meshes.json'
encoded = json.dumps(payload, separators=(',', ':')) + '\n'
if args.check:
    assert output.read_text() == encoded, 'Committed anatomy meshes differ; regenerate with the pinned tooling.'
else:
    output.write_text(encoded)
print(json.dumps({'groups': len(assets), 'trianglesOneSide': sum(len(p['faces']) for a in assets.values() for p in a['parts']), 'bytes': len(encoded)}))
