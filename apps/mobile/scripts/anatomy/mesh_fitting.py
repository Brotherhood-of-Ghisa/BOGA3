import bisect
import math


def cross2(a, b):
    return a[0] * b[1] - a[1] * b[0]


def hull(points):
    points = sorted(set(points))
    if len(points) < 3: return points
    lower, upper = [], []
    for stack, ordered in [(lower, points), (upper, reversed(points))]:
        for p in ordered:
            while len(stack) > 1 and cross2([stack[-1][k] - stack[-2][k] for k in range(2)], [p[k] - stack[-1][k] for k in range(2)]) <= 0:
                stack.pop()
            stack.append(p)
    return lower[:-1] + upper[:-1]


def sections(vertices, faces, levels, radius=None):
    output = [[] for _ in levels]
    for face in faces:
        points = [vertices[i] for i in face[:3]]
        low, high = min(p[1] for p in points), max(p[1] for p in points)
        for i in range(bisect.bisect_left(levels, low), bisect.bisect_left(levels, high)):
            for a, b in [(0, 1), (1, 2), (2, 0)]:
                p, q = points[a], points[b]
                if (p[1] < levels[i]) == (q[1] < levels[i]): continue
                t = (levels[i] - p[1]) / (q[1] - p[1])
                hit = (p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t)
                if radius is None or math.hypot(*hit) < radius: output[i].append(hit)
    return [hull(points) for points in output]


def radial_profile(polygon, count=32):
    centre = [sum(p[k] for p in polygon) / len(polygon) for k in range(2)]
    radii = []
    for i in range(count):
        angle = i * math.tau / count
        direction = [math.cos(angle), math.sin(angle)]
        hits = []
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            delta, edge = [a[k] - centre[k] for k in range(2)], [b[k] - a[k] for k in range(2)]
            denominator = cross2(direction, edge)
            if abs(denominator) < 1e-14: continue
            distance, along = cross2(delta, edge) / denominator, cross2(delta, direction) / denominator
            if distance > 0 and -.000001 <= along <= 1.000001: hits.append(distance)
        assert hits
        radii.append(min(hits))
    return centre + radii


def plane_contours(vertices, faces, level):
    graph = {}
    for face in faces:
        points = [vertices[i] for i in face[:3]]
        if not min(p[1] for p in points) < level < max(p[1] for p in points): continue
        hits = []
        for a, b in [(0, 1), (1, 2), (2, 0)]:
            p, q = points[a], points[b]
            if (p[1] < level) == (q[1] < level): continue
            t = (level - p[1]) / (q[1] - p[1])
            hits.append(tuple(round(p[k] + (q[k] - p[k]) * t, 8) for k in [0, 2]))
        if len(hits) != 2 or hits[0] == hits[1]: continue
        for p, q in [hits, hits[::-1]]: graph.setdefault(p, set()).add(q)
    contours, remaining = [], set(graph)
    while remaining:
        start = min(remaining); current, previous, polygon = start, None, []
        while current not in polygon:
            polygon.append(current); remaining.discard(current)
            choices = graph[current] - {previous}
            if not choices: break
            previous, current = current, min(choices)
        if current == start and len(polygon) >= 3: contours.append(polygon)
    return contours


def inside_polygon(point, polygon):
    x, z = point; inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]: inside = not inside
    return inside


def constrain_to_contours(point, contours):
    if any(inside_polygon(point, polygon) for polygon in contours): return point
    best = None
    for polygon in contours:
        centre = [sum(p[k] for p in polygon) / len(polygon) for k in range(2)]
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            edge = [b[k] - a[k] for k in range(2)]
            denominator = sum(n * n for n in edge)
            if not denominator: continue
            t = max(0, min(1, sum((point[k] - a[k]) * edge[k] for k in range(2)) / denominator))
            closest = [a[k] + t * edge[k] for k in range(2)]
            distance = math.dist(point, closest)
            if best is None or distance < best[0]: best = (distance, closest, centre)
    if best is None: return point
    _, closest, centre = best
    return [closest[k] * .98 + centre[k] * .02 for k in range(2)]


def forearm_fitter(source_skin, source_faces, target_skin, target_faces, registration, frame, dot, sub):
    source, target = registration['sourceProximal'], registration['targetProximal']
    sb = frame(sub(registration['sourceDistal'], source), [-1, 0, 0], [0, -1, 0])
    tb = frame(sub(registration['targetDistal'], target), [1, 0, 0], [0, 0, 1])
    scale = registration['uniformScale']
    source_local = [[dot(sub(p, source), a) for a in sb] for p in source_skin]
    target_local = [[dot(sub(p, target), a) for a in tb] for p in target_skin]
    source_wrist = math.dist(registration['sourceProximal'], registration['sourceDistal'])
    target_wrist = math.dist(registration['targetProximal'], registration['targetDistal'])
    source_tip = max(p[1] for p in source_local if math.hypot(p[0], p[2]) < 130 and p[1] > source_wrist)
    target_tip = max(p[1] for p in target_local if math.hypot(p[0], p[2]) < .14 and p[1] > target_wrist)
    def length(s):
        return s * scale if s <= source_wrist else target_wrist + (s - source_wrist) / (source_tip - source_wrist) * (target_tip - target_wrist)
    levels = [-90 + i * (source_tip - 92) / 64 for i in range(65)]
    target_levels = [length(s) for s in levels]
    # Keep the nearby thigh out of the forearm cage's distal cross-sections.
    arm_boundary = registration['sourceDistal'][0] + source_wrist * .35
    source_arm_faces = [f for f in source_faces if all(source_skin[i][0] < arm_boundary for i in f[:3])]
    source_rings = sections(source_local, source_arm_faces, levels, 130)
    target_rings = sections(target_local, target_faces, target_levels, .14)
    assert all(len(ring) > 2 for ring in source_rings + target_rings)
    source_profiles = [radial_profile(ring) for ring in source_rings]
    target_profiles = [radial_profile(ring) for ring in target_rings]
    hand_faces = [f for f in target_faces if all(target_skin[i][0] > target[0] - target_wrist * .4 for i in f[:3]) and max(target_local[i][1] for i in f[:3]) > target_wrist * .9]
    hand_contours = {}
    def constrain(mapped):
        if mapped[1] > target_wrist * .96:
            level = round(mapped[1], 5) + .00000001
            if level not in hand_contours: hand_contours[level] = plane_contours(target_local, hand_faces, level)
            mapped[0], mapped[2] = constrain_to_contours([mapped[0], mapped[2]], hand_contours[level])
        return mapped
    def constrain_world(p):
        mapped = constrain([dot(sub(p, target), a) for a in tb])
        return [target[k] + sum(mapped[j] * tb[j][k] for j in range(3)) for k in range(3)]
    def fit(p):
        local = [dot(sub(p, target), a) / scale for a in tb]
        s = local[1]
        i = max(0, min(len(levels) - 2, bisect.bisect_right(levels, s) - 1))
        t = max(0, min(1, (s - levels[i]) / (levels[i + 1] - levels[i])))
        source_profile = [a + (b - a) * t for a, b in zip(source_profiles[i], source_profiles[i + 1])]
        target_profile = [a + (b - a) * t for a, b in zip(target_profiles[i], target_profiles[i + 1])]
        dx, dz = local[0] - source_profile[0], local[2] - source_profile[1]
        angle = math.atan2(dz, dx) % math.tau
        sector = angle / math.tau * 32
        j, fraction = int(sector), sector % 1
        def radius(profile): return profile[2 + j] * (1 - fraction) + profile[2 + (j + 1) % 32] * fraction
        ratio = min(.97, math.hypot(dx, dz) / radius(source_profile))
        radial = ratio * radius(target_profile)
        mapped = [target_profile[0] + math.cos(angle) * radial, length(s), target_profile[1] + math.sin(angle) * radial]
        # Fit to the actual separate thumb/finger contours, not their convex envelope.
        mapped = constrain(mapped)
        return [target[k] + sum(mapped[j] * tb[j][k] for j in range(3)) for k in range(3)]
    fit.constrain = constrain_world
    return fit, {'sourceWrist': source_wrist, 'sourceTip': source_tip, 'targetWrist': target_wrist, 'targetTip': target_tip, 'levels': len(levels), 'method': 'Cross-section cage fitted to the existing arm and hand; source tendon mesh retained.'}


def erector_envelopes(parts):
    columns = {'iliocostalis': ['FJ1527', 'FJ1528', 'FJ1526'], 'longissimus': ['FJ1535', 'FJ1534', 'FJ1533'], 'spinalis': ['FJ1544', 'FJ1543']}
    lookup = {p['id']: p for p in parts}
    result = []
    for column, ids in columns.items():
        points, triangles = [], []
        for id in ids:
            p = lookup[id]; offset = len(points)
            points.extend(p['vertices']); triangles.extend([[i + offset for i in f] for f in p['faces']])
        low, high = min(p[1] for p in points), max(p[1] for p in points)
        levels = [low + (high - low) * (.002 + .996 * i / 42) for i in range(43)]
        rings = sections(points, triangles, levels)
        assert all(len(ring) > 2 for ring in rings)
        profiles = []
        for ring in rings:
            lo = [min(p[k] for p in ring) for k in range(2)]
            hi = [max(p[k] for p in ring) for k in range(2)]
            profiles.append([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2])
        # This is a smooth group envelope, not a replacement claim for the individual atlas anatomy.
        for _ in range(4):
            profiles = [profiles[0]] + [[(profiles[i - 1][k] + 2 * profiles[i][k] + profiles[i + 1][k]) / 4 for k in range(4)] for i in range(1, len(profiles) - 1)] + [profiles[-1]]
        vertices, faces, sides = [], [], 12
        for i, (y, profile) in enumerate(zip(levels, profiles)):
            x, z, rx, rz = profile
            rx = min(rx, max(.0005, x * .85))
            for j in range(sides):
                angle = math.tau * (j + (i % 2) * .5) / sides
                vertices.append([x + math.cos(angle) * rx, y, z + math.sin(angle) * rz])
        for i in range(len(levels) - 1):
            for j in range(sides):
                a, b = i * sides + j, i * sides + (j + 1) % sides
                c, d = (i + 1) * sides + j, (i + 1) * sides + (j + 1) % sides
                if i % 2: faces.extend([[a, b, d], [a, d, c]])
                else: faces.extend([[a, b, c], [b, d, c]])
        for ring, direction in [(0, -1), (len(levels) - 1, 1)]:
            x, z, _, _ = profiles[ring]
            centre = len(vertices); vertices.append([x, low if direction < 0 else high, z])
            for j in range(sides):
                a, b = ring * sides + j, ring * sides + (j + 1) % sides
                faces.append([centre, b, a] if direction < 0 else [centre, a, b])
        result.append({'id': 'erector-' + column, 'vertices': vertices, 'faces': faces, 'sourceParts': ids})
    return result


def surface_envelopes(key, vertices, faces, components):
    result = []
    for index, (points, triangles) in enumerate(components(vertices, faces)):
        normals = [[0., 0., 0.] for _ in points]
        edges = {}
        for a, b, c in triangles:
            u = [points[b][k] - points[a][k] for k in range(3)]
            v = [points[c][k] - points[a][k] for k in range(3)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            for i in [a, b, c]: normals[i] = [normals[i][k] + n[k] for k in range(3)]
            for p, q in [(a,b),(b,c),(c,a)]:
                edge = tuple(sorted((p,q)))
                edges.setdefault(edge, []).append((p,q))
        count = len(points)
        inside = [[round(p[k] - .012*n[k]/(math.hypot(*n) or 1), 7) for k in range(3)] for p,n in zip(points,normals)]
        closed = [list(f) for f in triangles] + [[c+count,b+count,a+count] for a,b,c in triangles]
        for uses in edges.values():
            if len(uses) != 1: continue
            a,b = uses[0]
            closed.extend([[b,a,a+count],[b,a+count,b+count]])
        result.append({'id': key+'-surface-'+str(index), 'vertices': points+inside, 'faces': closed})
    return result
