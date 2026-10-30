// Connect only the same cut level on the same original OBJ edge, never nearby points.
function contourChains(segments, ports) {
  const ends = new Map();
  ports.forEach(([level, a, b, c, d], index) => {
    [[a, b], [c, d]].forEach(([u, v], end) => {
      const key = `${level}:${u}:${v}`;
      const list = ends.get(key) ?? [];
      list.push([index, end]);
      ends.set(key, list);
    });
  });
  const neighbours = new Map();
  for (const list of ends.values()) {
    if (list.length !== 2 || list[0][0] === list[1][0]) continue;
    const [[a, ae], [b, be]] = list;
    if (![0, 1, 2].every(k => segments[a][ae * 3 + k] === segments[b][be * 3 + k])) continue;
    neighbours.set(`${a}:${ae}`, [b, be]);
    neighbours.set(`${b}:${be}`, [a, ae]);
  }
  const unused = new Set(segments.map((_, index) => index));
  const chains = [];
  const trace = (index, end) => {
    const chain = [];
    while (unused.delete(index)) {
      chain.push(end === 0 ? index : -index - 1);
      const next = neighbours.get(`${index}:${1 - end}`);
      if (!next) break;
      [index, end] = next;
    }
    if (chain.length) chains.push(chain);
  };
  segments.forEach((_, index) => {
    for (const end of [0, 1]) if (unused.has(index) && !neighbours.has(`${index}:${end}`)) trace(index, end);
  });
  for (const index of unused) trace(index, 0);
  return chains;
}

module.exports = { contourChains };
