"""Bake the approved coarse display surfaces; no remeshing runs on the device."""
import math
from collections import Counter, defaultdict
import numpy as np
import pymeshlab as ml
from mesh_fitting import plane_contours, constrain_to_contours, sections, radial_profile


def volume(v, f):
    p = v[f]
    return float(np.einsum('ij,ij->i', p[:, 0], np.cross(p[:, 1], p[:, 2])).sum() / 6)


def topology(f):
    edges = Counter(tuple(sorted((int(a), int(b)))) for tri in f for a, b in zip(tri, np.roll(tri, -1)))
    return (len(set(f.flat)) - len(edges) + len(f), sum(n == 1 for n in edges.values()), sum(n > 2 for n in edges.values()))


def components(vertices, faces):
    v = np.asarray(vertices, dtype=float); f = np.asarray(faces, dtype=np.int32)
    parent = list(range(len(f))); edges = {}
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i, tri in enumerate(f):
        for a, b in zip(tri, np.roll(tri, -1)):
            edge = tuple(sorted((int(a), int(b))))
            if edge in edges: parent[find(i)] = find(edges[edge])
            else: edges[edge] = i
    groups = defaultdict(list)
    for i in range(len(f)): groups[find(i)].append(i)
    for indices in groups.values():
        triangles = f[indices]; used = np.unique(triangles)
        remap = np.full(len(v), -1); remap[used] = np.arange(len(used))
        yield v[used], remap[triangles].astype(np.int32)


def close_boundaries(v, f, offset=0.):
    uses = defaultdict(list)
    for tri in f:
        for a, b in zip(tri, np.roll(tri, -1)):
            uses[tuple(sorted((int(a), int(b))))].append((int(a), int(b)))
    boundary = [items[0] for items in uses.values() if len(items) == 1]
    graph = defaultdict(set)
    for a, b in boundary: graph[a].add(b); graph[b].add(a)
    if any(len(neighbors) != 2 for neighbors in graph.values()): return None
    remaining = set(graph); extra = []
    while remaining:
        start = remaining.pop(); seen = {start}; todo = [start]
        while todo:
            for nxt in graph[todo.pop()] - seen:
                seen.add(nxt); remaining.discard(nxt); todo.append(nxt)
        index = len(v); v = np.vstack((v, v[list(seen)].mean(axis=0) + [0., 0., offset]))
        extra.extend([[b, a, index] for a, b in boundary if a in seen])
    if extra: f = np.vstack((f, np.array(extra, dtype=np.int32)))
    if topology(f)[1:] != (0, 0): return None
    return v, f[:, [0, 2, 1]] if volume(v, f) < 0 else f


def clean_part(part):
    v = np.array(part['vertices'], dtype=float); f = np.array(part['faces'], dtype=np.int32)
    if topology(f)[1:] == (0, 0): return list(components(v, f))
    ms = ml.MeshSet(); ms.add_mesh(ml.Mesh(v, f))
    ms.meshing_remove_null_faces(); ms.meshing_remove_duplicate_faces()
    ms.meshing_repair_non_manifold_edges(method='Remove Faces'); ms.meshing_repair_non_manifold_vertices()
    ms.meshing_close_holes(maxholesize=200, selfintersection=False)
    v = ms.current_mesh().vertex_matrix(); f = ms.current_mesh().face_matrix()
    result = close_boundaries(v, f, 1e-6)
    assert result is not None, (part['id'], 'source repair failed')
    return [(v, f) for v, f in components(*result) if abs(volume(v, f)) > 1e-15]


def orient(v, f):
    uses = defaultdict(list)
    for i, tri in enumerate(f):
        for a, b in zip(tri, np.roll(tri, -1)):
            uses[tuple(sorted((int(a), int(b))))].append((i, a < b))
    adjacent = defaultdict(list)
    for edges in uses.values():
        assert len(edges) == 2, 'Open or nonmanifold display surface'
        (a, da), (b, db) = edges
        adjacent[a].append((b, da == db)); adjacent[b].append((a, da == db))
    flips = {}
    for seed in range(len(f)):
        if seed in flips: continue
        flips[seed] = False; todo = [seed]; component = []
        while todo:
            face = todo.pop(); component.append(face)
            for other, toggle in adjacent[face]:
                expected = flips[face] ^ toggle
                if other in flips: assert flips[other] == expected, 'Nonorientable display surface'
                else: flips[other] = expected; todo.append(other)
        for face in component:
            if flips[face]: f[face] = f[face, [0, 2, 1]]
        if volume(v, f[component]) < 0: f[component] = f[component][:, [0, 2, 1]]
    return f


class CoarseMeshes:
    def __init__(self, body, registration):
        self.origin = np.array(registration['targetProximal'])
        axis = np.array(registration['targetDistal']) - self.origin
        self.wrist = float(np.linalg.norm(axis)); axis /= self.wrist
        out = np.array([1., 0, 0]); out -= np.dot(out, axis) * axis; out /= np.linalg.norm(out)
        front = np.array([0., 0, 1]); front -= np.dot(front, axis) * axis + np.dot(front, out) * out; front /= np.linalg.norm(front)
        self.basis = np.array([out, axis, front]); self.contours = {}
        body_v = np.array(body['vertices']); self.local_body = (body_v - self.origin) @ self.basis.T
        self.hand_faces = [f for f in body['faces'] if all(body_v[i, 0] > self.origin[0] - self.wrist * .4 for i in f[:3]) and max(self.local_body[i, 1] for i in f[:3]) > self.wrist * .9]

    def fit_hand(self, vertices):
        result = (vertices - self.origin) @ self.basis.T
        for p in result:
            if p[1] <= self.wrist * .96: continue
            level = round(float(p[1]), 5) + .00000001
            if level not in self.contours:
                self.contours[level] = plane_contours(self.local_body, self.hand_faces, level)
            p[0], p[2] = constrain_to_contours([p[0], p[2]], self.contours[level])
        return self.origin + result @ self.basis

    def remesh(self, v, f, settings, group):
        length, error, iterations = settings
        if len(f) < 24: return v, f
        before = abs(volume(v, f)); original_topology = topology(f); candidates = []
        for factor in [1., .8, .6]:
            ms = ml.MeshSet(); ms.add_mesh(ml.Mesh(v, f))
            ms.meshing_isotropic_explicit_remeshing(iterations=iterations, adaptive=False, targetlen=ml.PureValue(length * factor), featuredeg=150, checksurfdist=True, maxsurfdist=ml.PureValue(error * factor), smoothflag=True, reprojectflag=True)
            nv = ms.current_mesh().vertex_matrix(); nf = ms.current_mesh().face_matrix()
            if group == 'traps_upper' and topology(nf)[1:] != (0, 0):
                repaired = clean_part({'id': 'FJ1521-display', 'vertices': nv, 'faces': nf})
                if len(repaired) != 1: continue
                nv, nf = repaired[0]
            span = np.ptp(nv, axis=0)
            if len(nf) < 8 or np.min(span) < 1e-12: continue
            nv = v.min(axis=0) + (nv - nv.min(axis=0)) * np.ptp(v, axis=0) / span
            if group == 'forearms_grip': nv = self.fit_hand(nv)
            nv = np.round(nv, 7)
            ratio = abs(volume(nv, nf)) / before if before > 1e-15 else 1.
            if topology(nf)[1:] != (0, 0) or (group != 'traps_upper' and topology(nf) != original_topology): continue
            if not .85 <= ratio <= 1.15 or len(nf) >= len(f): continue
            p = nv[nf]
            if np.any(np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1) < 1e-15): continue
            candidates.append((len(nf), nv, nf))
        if not candidates: return v, f
        _, nv, nf = min(candidates, key=lambda item: item[0])
        return nv, nf[:, [0, 2, 1]] if volume(nv, nf) < 0 else nf

    def forearm_envelope(self, current, reduced):
        vertices = []; faces = []
        for part in current['parts']:
            offset = len(vertices); vertices.extend(part['vertices'])
            faces.extend([[i + offset for i in face] for face in part['faces']])
        world = np.array(vertices); local = (world - self.origin) @ self.basis.T
        low = float(local[:, 1].min()); high = self.wrist * .99; sides = 8
        levels = np.linspace(low + .00004, high, max(8, math.ceil((high - low) / .034) + 1)).tolist()
        profiles = [radial_profile(ring) for ring in sections(local, np.array(faces), levels)]
        out = []; triangles = []
        for i, (s, profile) in enumerate(zip(levels, profiles)):
            cx, cz, *radii = profile
            for j in range(sides):
                angle = 2 * math.pi * (j + (i % 2) * .5) / sides
                t = (angle % (2 * math.pi)) / (2 * math.pi) * len(radii); a = int(t); fraction = t - a
                radius = (radii[a] * (1 - fraction) + radii[(a + 1) % len(radii)] * fraction) * .995
                out.append([cx + math.cos(angle) * radius, s, cz + math.sin(angle) * radius])
        for i in range(len(levels) - 1):
            for j in range(sides):
                a = i * sides + j; b = i * sides + (j + 1) % sides; c = (i + 1) * sides + j; d = (i + 1) * sides + (j + 1) % sides
                triangles.extend([[a, b, d], [a, d, c]] if i % 2 else [[a, b, c], [b, d, c]])
        for ring, s in [(0, low), (len(levels) - 1, high + .00004)]:
            p = profiles[ring]; index = len(out); out.append([p[0], s, p[1]])
            for j in range(sides): triangles.append([index, ring * sides + (j + 1) % sides, ring * sides + j] if ring == 0 else [index, ring * sides + j, ring * sides + (j + 1) % sides])
        v = self.fit_hand(self.origin + np.array(out) @ self.basis); f = np.array(triangles, dtype=np.int32)
        parts = [{'id': 'forearm-group-envelope', 'vertices': v.tolist(), 'faces': f.tolist()}]
        for source in reduced['parts']:
            points = np.array(source['vertices']); fs = np.array(source['faces'], dtype=np.int32)
            s = ((points - self.origin) @ self.basis.T)[:, 1]
            selected = fs[np.all(s[fs] > self.wrist * .89, axis=1)]
            if not len(selected): continue
            for index, (pv, pf) in enumerate(components(points, selected)):
                closed = close_boundaries(pv, pf)
                if closed is None or abs(volume(*closed)) < 1e-14: continue
                pv, pf = closed
                parts.append({'id': source['id'] + '-distal-' + str(index), 'vertices': pv.tolist(), 'faces': pf.tolist()})
        combined = np.array([p for part in parts for p in part['vertices']])
        for part in parts:
            pv = world.min(axis=0) + (np.array(part['vertices']) - combined.min(axis=0)) * np.ptp(world, axis=0) / np.ptp(combined, axis=0)
            part['vertices'] = np.round(self.fit_hand(pv), 7).tolist()
        return {'kind': 'envelope', 'mirror': True, 'parts': parts, 'derivation': 'Outer group surface with retained distal tendons'}


def coarse_muscles(assets, body, manifest):
    builder = CoarseMeshes(body, manifest['registration']['FJ3349'])
    clean = {group: [(p['id'], clean_part(p)) for p in muscle['parts']] for group, muscle in assets.items()}
    previous = {}
    # The intermediate pass supplies a denser fallback when a coarse candidate loses shape.
    for settings in [(.022, .0015, 4), (.035, .003, 6)]:
        result = {}
        for group, muscle in assets.items():
            parts = []
            for source_id, pieces in clean[group]:
                for index, (v, f) in enumerate(pieces):
                    nv, nf = (v, f) if muscle['kind'] == 'surface' else builder.remesh(v, f, settings, group)
                    part_id = source_id + '-' + str(index)
                    if group in previous:
                        prior = next(p for p in previous[group]['parts'] if p['id'] == part_id)
                        if len(prior['faces']) < len(nf): nv, nf = np.array(prior['vertices']), np.array(prior['faces'], dtype=np.int32)
                    assert topology(nf)[1:] == (0, 0), (group, part_id)
                    extent = np.max(np.abs(np.stack((v.min(axis=0), v.max(axis=0))) - np.stack((nv.min(axis=0), nv.max(axis=0)))))
                    assert extent < (.003 if group == 'forearms_grip' else 2e-7), (group, extent)
                    if volume(nv, nf) < 0: nf = nf[:, [0, 2, 1]]
                    parts.append({'id': part_id, 'vertices': np.round(nv, 7).tolist(), 'faces': nf.tolist()})
            result[group] = {'kind': muscle['kind'], 'parts': parts, 'mirror': muscle['mirror']}
        previous = result
    # shortcut: a group shell replaces overlapping proximal forearm parts; individual-muscle selection needs separate surfaces.
    result['forearms_grip'] = builder.forearm_envelope(assets['forearms_grip'], result['forearms_grip'])
    for group, muscle in result.items():
        for part in muscle['parts']:
            v = np.array(part['vertices']); f = orient(v, np.array(part['faces'], dtype=np.int32))
            p = v[f]
            assert np.all(np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1) > 1e-15), (group, part['id'])
            part['faces'] = f.tolist()
        if group != 'forearms_grip':
            # Keep each atlas source as one runtime part after remeshing its connected components.
            grouped = {}
            for part in muscle['parts']:
                source_id = part['id'].rsplit('-', 1)[0]
                target = grouped.setdefault(source_id, {'id': source_id, 'vertices': [], 'faces': []})
                offset = len(target['vertices']); target['vertices'].extend(part['vertices'])
                target['faces'].extend([[i + offset for i in f] for f in part['faces']])
            muscle['parts'] = list(grouped.values())
    return result
