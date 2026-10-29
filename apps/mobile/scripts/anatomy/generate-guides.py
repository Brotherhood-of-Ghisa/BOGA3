import argparse
import gzip
import io
import hashlib
import json
from pathlib import Path
import numpy as np
from collections import defaultdict

repo = Path(__file__).resolve().parents[4]
parser = argparse.ArgumentParser(description='Regenerate registered schematic guides from pinned BodyParts3D source meshes (requires NumPy offline).')
parser.add_argument('--source-dir', type=Path, default=repo / 'apps/mobile/artifacts/muscle-body-anatomy/source')
args = parser.parse_args()
source = args.source_dir
root = Path(__file__).resolve().parent
metadata = json.loads((root / 'source.json').read_text())
for key, record in metadata['sources']['models'].items():
    assert hashlib.sha256((source / (key + '.obj')).read_bytes()).hexdigest() == record['sha256'], key

def obj(name):
    vertices, faces = [], []
    for line in (source / (name + '.obj')).read_text().splitlines():
        values = line.split()
        if not values:
            continue
        if values[0] == 'v':
            vertices.append([float(v) for v in values[1:4]])
        if values[0] == 'f':
            face = [int(v.split('/')[0]) - 1 for v in values[1:]]
            faces.extend([[face[0], face[i], face[i + 1]] for i in range(1, len(face) - 1)])
    return np.array(vertices), np.array(faces)

def frame(axis, outward, front):
    axis = axis / np.linalg.norm(axis)
    outward = outward - np.dot(outward, axis) * axis
    outward /= np.linalg.norm(outward)
    front = front - np.dot(front, axis) * axis - np.dot(front, outward) * outward
    front /= np.linalg.norm(front)
    return np.array([outward, axis, front]).T

registrations = {}

def registration(bone, proximal, distal):
    vertices, _ = obj(bone)
    low, high = np.quantile(vertices[:, 2], [.05, .95])
    start = vertices[vertices[:, 2] >= high].mean(axis=0)
    end = vertices[vertices[:, 2] <= low].mean(axis=0)
    origin = np.array(proximal)
    target = np.array(distal)
    basis = frame(end - start, np.array([-1., 0., 0.]), np.array([0., -1., 0.]))
    destination = frame(target - origin, np.array([1., 0., 0.]), np.array([0., 0., 1.]))
    scale = np.linalg.norm(target - origin) / np.linalg.norm(end - start)
    registrations[bone] = {'sourceProximal': start.tolist(), 'sourceDistal': end.tolist(),
        'targetProximal': proximal, 'targetDistal': distal, 'uniformScale': float(scale),
        'method': 'Bone end-centroid registration to manually chosen BoGa joint centres; mirrored to opposite side; not anatomically validated.'}
    return lambda points: (points - start) @ basis @ destination.T * scale + origin

arm = registration('FJ3368', [.247, .54, -.015], [.348, .245, 0.])

def body_leg_centre(height):
    body = json.loads((repo / 'apps/mobile/components/stats/muscle-body-mesh.json').read_text())
    vertices = np.array(body['vertices'])
    intersections = []
    for face in body['faces']:
        triangle = vertices[face[:3]]
        for a, b in [(0, 1), (1, 2), (2, 0)]:
            if (triangle[a, 1] < height) == (triangle[b, 1] < height):
                continue
            point = triangle[a] + (triangle[b] - triangle[a]) * (height - triangle[a, 1]) / (triangle[b, 1] - triangle[a, 1])
            if point[0] > 0:
                intersections.append(point)
    assert intersections, 'Leg registration needs a body cross-section'
    points = np.array(intersections)
    return ((points.min(axis=0) + points.max(axis=0)) / 2).tolist()

# The avatar's lower legs lean outward and backward; both ends must follow that axis.
leg = registration('FJ3387', body_leg_centre(-.423), body_leg_centre(-.876))
registrations['FJ3387']['method'] = 'Bone end-centroid registration to body-derived lower-leg pose landmarks; mirrored to opposite side; not anatomically validated.'
registrations['FJ3387']['targetMethod'] = 'Centres of positive-x body cross-section bounds at the knee/ankle heights; visual alignment, not clinically identified tibial landmarks.'

def section_components(vertices, faces, height, axis):
    triangles = vertices[faces]
    active = triangles[(triangles[:, :, axis].min(1) <= height) & (triangles[:, :, axis].max(1) > height)]
    graph = defaultdict(set)
    for triangle in active:
        hits = []
        for a, b in [(0, 1), (1, 2), (2, 0)]:
            if (triangle[a, axis] < height) == (triangle[b, axis] < height):
                continue
            p = triangle[a] + (triangle[b] - triangle[a]) * (height - triangle[a, axis]) / (triangle[b, axis] - triangle[a, axis])
            hits.append(tuple(np.round(p, 4)))
        if len(hits) == 2:
            graph[hits[0]].add(hits[1])
            graph[hits[1]].add(hits[0])
    unseen, components = set(graph), []
    while unseen:
        todo, component = [unseen.pop()], []
        while todo:
            p = todo.pop()
            component.append(p)
            for q in graph[p] & unseen:
                unseen.remove(q)
                todo.append(q)
        if len(component) >= 4:
            components.append(np.array(component))
    assert components, f'Missing body section at {height}'
    return components

body = json.loads((repo / 'apps/mobile/components/stats/muscle-body-mesh.json').read_text())
body_vertices = np.array(body['vertices'])
body_faces = np.array([face[:3] for face in body['faces']])

def outer_limb_centre(height):
    parts = section_components(body_vertices, body_faces, height, 1)
    points = max(parts, key=lambda part: part[:, 0].mean())
    return ((points.min(0) + points.max(0)) / 2).tolist()

def inner_leg_centre(height):
    parts = section_components(body_vertices, body_faces, height, 1)
    positive = [part[part[:, 0] > 0] for part in parts if np.any(part[:, 0] > 0)]
    points = min(positive, key=lambda part: part[:, 0].mean())
    return ((points.min(0) + points.max(0)) / 2).tolist()

forearm = registration('FJ3349', outer_limb_centre(.245), outer_limb_centre(.026))
thigh = registration('FJ3365', inner_leg_centre(-.06), inner_leg_centre(-.423))
for bone in ['FJ3349', 'FJ3365']:
    registrations[bone]['method'] = 'Bone end-centroid registration to avatar cross-section pose landmarks; mirrored; provisional.'

def central_bounds(vertices, faces, height, axis):
    parts = section_components(vertices, faces, height, axis)
    central = [part for part in parts if part[:, 0].min() < 0 < part[:, 0].max()]
    if central:
        points = np.concatenate(central)
    else:
        # At the groin, finger contours must not widen the two inner leg contours.
        nearest = min(abs(part[:, 0].mean()) for part in parts)
        points = np.concatenate([part for part in parts if abs(part[:, 0].mean()) <= nearest * 1.5])
    return np.array([points.min(0), points.max(0)])

skin, skin_faces = obj('FJ2810')
source_heights = np.array([700., 735., 834., 950., 1100., 1250., 1332., 1400., 1500.])
target_heights = np.array([-.19, -.15, -.06, .08, .27, .445, .54, .65, .80])
profile_z = np.linspace(700, 1500, 65)
source_profiles = np.array([central_bounds(skin, skin_faces, z, 2) for z in profile_z])
profile_y = np.interp(profile_z, source_heights, target_heights)
target_profiles = np.array([central_bounds(body_vertices, body_faces, y, 1) for y in profile_y])

def torso(points):
    z = points[:, 2]
    source_x = np.interp(z, profile_z, np.max(np.abs(source_profiles[:, :, 0]), axis=1))
    target_x = np.interp(z, profile_z, np.max(np.abs(target_profiles[:, :, 0]), axis=1))
    front = np.interp(z, profile_z, source_profiles[:, 0, 1])
    back = np.interp(z, profile_z, source_profiles[:, 1, 1])
    target_front = np.interp(z, profile_z, target_profiles[:, 1, 2])
    target_back = np.interp(z, profile_z, target_profiles[:, 0, 2])
    x = -points[:, 0] * target_x / source_x
    depth = target_back + (back - points[:, 1]) / (back - front) * (target_front - target_back)
    return np.column_stack([x, np.interp(z, source_heights, target_heights), depth])

registrations['torso'] = {'method': 'Atlas skin cross-section registration to the avatar, with piecewise vertical pose landmarks; provisional visual deformation, not measured anatomy.',
    'sourceHeights': source_heights.tolist(), 'targetHeights': target_heights.tolist(), 'reference': 'FJ2810',
    'targetMeshSha256': hashlib.sha256((repo / 'apps/mobile/components/stats/muscle-body-mesh.json').read_bytes()).hexdigest()}

def longitudinal_field(points):
    centred = points - points.mean(0)
    _, _, axes = np.linalg.svd(centred, full_matrices=False)
    along = centred @ axes[0]
    across = centred @ axes[1]
    samples = np.linspace(along.min(), along.max(), 33)
    centres, widths = [], []
    for level in samples:
        local = across[np.argsort(np.abs(along - level))[:max(8, len(points) // 40)]]
        centres.append((local.min() + local.max()) / 2)
        widths.append(max((local.max() - local.min()) / 2, .0001))
    return (across - np.interp(along, samples, centres)) / np.interp(along, samples, widths)

def guide_field(points, family):
    x, y, z = points.T
    if family not in ['brachialis', 'calves']:
        return longitudinal_field(points)
    if family == 'brachialis':
        return x + .342 * y
    return y - 3.2 * np.abs(x - np.median(x))

def cut_mesh(vertices, faces, transform, family, count):
    # OBJ normal/export seams duplicate vertices: topology identity uses exact source XYZ, never proximity.
    vertex_keys = [','.join(str(float(v) + 0.0) for v in point) for point in vertices]
    points = transform(vertices)
    triangles = points[faces]
    orientation = 1 if np.einsum('ij,ij->i', triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() >= 0 else -1
    # shortcut: these plane cuts indicate fibre direction, not measured fascicles; replace after anatomy review.
    values = guide_field(points, family)
    lo, hi = ([-.95, .95] if family not in ['brachialis', 'calves'] else np.quantile(values, [.015, .985]))
    lines, normals, ports = [], [], []
    levels = np.linspace(lo, hi, count + 2)[1:-1] if family in ['brachialis', 'calves'] else np.linspace(lo, hi, count)
    for level_index, level in enumerate(levels):
        for face in faces:
            triangle, scalar = points[face], values[face] - level
            hits, edges = [], []
            for a, b in [(0, 1), (1, 2), (2, 0)]:
                if (scalar[a] < 0) == (scalar[b] < 0):
                    continue
                point = triangle[a] + (triangle[b] - triangle[a]) * scalar[a] / (scalar[a] - scalar[b])
                if not any(np.linalg.norm(point - p) < 1e-8 for p in hits):
                    hits.append(point)
                    edges.append(sorted([vertex_keys[face[a]], vertex_keys[face[b]]]))
            if len(hits) == 2 and np.linalg.norm(hits[0] - hits[1]) > 1e-7:
                normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0]) * orientation
                length = np.linalg.norm(normal)
                if length < 1e-12:
                    continue
                lines.append(np.round(hits, 6).tolist())
                normal /= length
                normals.append(np.round(normal, 5).tolist())
                ports.append([level_index, *edges[0], *edges[1]])
    mirrored = [[[-p[0], p[1], p[2]] for p in line] for line in lines]
    return {'segments': lines + mirrored, 'normals': normals + [[-n[0], n[1], n[2]] for n in normals], 'ports': ports}

specs = {
    'brachialis': ('Brachialis', ['FJ1486'], arm, False, 7),
    'rotator_cuff': ('Rotator cuff', ['FJ1506', 'FJ1500', 'FJ1508', 'FJ1504'], torso, False, 4),
    'back_upper': ('Upper back', ['FJ1536', 'FJ1537'], torso, True, 5),
    'serratus_anterior': ('Serratus', ['FJ1459'], torso, False, 8),
    'hip_flexors': ('Hip flexors', ['FJ1431', 'FJ1422'], torso, False, 5),
    'hip_abductors': ('Hip abductors', ['FJ1419', 'FJ1420'], torso, False, 5),
    'calves': ('Calves', ['FJ1394', 'FJ1397', 'FJ1437'], leg, False, 6),
    'quads': ('Quads', ['FJ1433', 'FJ1441', 'FJ1442', 'FJ1443'], thigh, False, 4),
    'triceps': ('Triceps', ['FJ1480', 'FJ1477', 'FJ1479'], arm, False, 4),
    'hamstrings': ('Hamstrings', ['FJ1435', 'FJ1444', 'FJ1436', 'FJ1395'], thigh, False, 4),
    'adductors': ('Adductors', ['FJ1401', 'FJ1403', 'FJ1402', 'FJ1421', 'FJ1427'], thigh, False, 4),
    'forearms_grip': ('Forearms', ['FJ1497', 'FJ1498', 'FJ1503', 'FJ1505', 'FJ1484', 'FJ1494', 'FJ1495', 'FJ1493',
        'FJ1496', 'FJ1502', 'FJ1475', 'FJ1499', 'FJ1487', 'FJ1490', 'FJ1489', 'FJ1492', 'FJ1491', 'FJ1472', 'FJ1517', 'FJ1474', 'FJ1516', 'FJ1473', 'FJ1518'], forearm, False, 3),
    'spinal_erectors': ('Spinal erectors', ['FJ1527', 'FJ1528', 'FJ1526', 'FJ1535', 'FJ1534', 'FJ1533', 'FJ1544', 'FJ1543'], torso, False, 3),
    'chest': ('Chest · pectoralis minor', ['FJ1456'], torso, True, 6),
}
groups = {}
coverage = {}
for family, (_, parts, transform, _, count) in specs.items():
    entries = []
    for part in parts:
        vertices, faces = obj(part)
        guides = cut_mesh(vertices, faces, transform, family, count)
        measured = np.array(guides['segments'][:len(guides['segments']) // 2]).reshape(-1, 3)
        full = transform(vertices)
        spans = full.max(0) - full.min(0)
        coverage[part] = {'family': family, 'sourceBounds': np.round([full.min(0), full.max(0)], 6).tolist(),
            'guideBounds': np.round([measured.min(0), measured.max(0)], 6).tolist(),
            'axisCoverage': np.round((measured.max(0) - measured.min(0)) / np.maximum(spans, .00001), 4).tolist()}
        entries.append({'id': part, **guides})
    groups[family] = entries

# Preserve every approved endpoint and normal; store only one side for the runtime mirror.
packed = {}
for family, parts in groups.items():
    packed[family] = []
    for part in parts:
        size = len(part['segments']) // 2
        rows = [a + b + n for (a, b), n in zip(part['segments'][:size], part['normals'][:size])]
        packed[family].append({'id': part['id'], 'segments': rows})
assert registrations == metadata['registration'], 'Registration drift: review before updating inputs'
assert coverage == metadata['coverage'], 'Source extent drift: review before updating inputs'
data = json.dumps(packed, separators=(',', ':')).encode()
assert hashlib.sha256(data).hexdigest() == metadata['registeredGuidesSha256'], 'Guide drift: review before updating inputs'
buffer = io.BytesIO()
with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0) as output:
    output.write(data)
(root / 'registered-guides.json.gz').write_bytes(buffer.getvalue())
topology = {part['id']: part['ports'] for parts in groups.values() for part in parts}
data = json.dumps(topology, separators=(',', ':')).encode()
assert hashlib.sha256(data).hexdigest() == metadata['registeredTopologySha256'], 'Topology drift: review before updating inputs'
buffer = io.BytesIO()
with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0) as output:
    output.write(data)
(root / 'registered-topology.json.gz').write_bytes(buffer.getvalue())
print('Reproduced all 63 registered source components byte-for-byte')
