// 2D "net" preview of a scrambled 3x3, drawn as SVG.
// The cube is modelled as 54 stickers, each with a position (x,y,z in -1..1) and a
// facing direction. A face turn rotates every sticker in that layer, so there are no

const NORMAL = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

const FACES = Object.keys(NORMAL);

const COLORS = {
  U: '#f4f4f1', // white
  D: '#f6d14a', // yellow
  F: '#3fbf6e', // green
  B: '#3b82f6', // blue
  R: '#e5484d', // red
  L: '#f08a24', // orange
};

// Where each face sits in the cross layout, in sticker units.
const ORIGIN = {
  U: [3, 0],
  L: [0, 3],
  F: [3, 3],
  R: [6, 3],
  B: [9, 3],
  D: [3, 6],
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Quarter turn clockwise as seen from outside = -90 degrees about the outward axis.
const quarterTurn = (v, axis) => {
  const d = dot(axis, v);
  const c = cross(axis, v);
  return [axis[0] * d - c[0], axis[1] * d - c[1], axis[2] * d - c[2]];
};

function solvedStickers() {
  const stickers = [];
  for (const face of FACES) {
    const n = NORMAL[face];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const p = [x, y, z];
          if (dot(p, n) === 1) stickers.push({ p, n: [...n], face });
        }
  }
  return stickers;
}

function applyMove(stickers, move) {
  const face = move[0];
  const axis = NORMAL[face];
  if (!axis) throw new Error(`Unknown move: ${move}`);
  const turns = move[1] === "'" ? 3 : move[1] === '2' ? 2 : 1;
  for (const s of stickers) {
    if (dot(s.p, axis) !== 1) continue;
    for (let i = 0; i < turns; i++) {
      s.p = quarterTurn(s.p, axis);
      s.n = quarterTurn(s.n, axis);
    }
  }
}

// Row/column of a sticker inside the face it currently sits on, as drawn in the net.
function cellOf(s) {
  const [x, y, z] = s.p;
  const facing = FACES.find((f) => dot(NORMAL[f], s.n) === 1);
  switch (facing) {
    case 'U': return [facing, z + 1, x + 1];
    case 'D': return [facing, 1 - z, x + 1];
    case 'F': return [facing, 1 - y, x + 1];
    case 'B': return [facing, 1 - y, 1 - x];
    case 'R': return [facing, 1 - y, 1 - z];
    case 'L': return [facing, 1 - y, z + 1];
  }
}

// Returns { U: [[a,b,c],[d,e,f],[g,h,i]], ... } where each entry is the face the sticker
export function scrambledFaces(scramble) {
  const stickers = solvedStickers();
  for (const move of scramble.trim().split(/\s+/).filter(Boolean)) applyMove(stickers, move);

  const grid = Object.fromEntries(FACES.map((f) => [f, [[], [], []]]));
  for (const s of stickers) {
    const [facing, row, col] = cellOf(s);
    grid[facing][row][col] = s.face;
  }
  return grid;
}

// Flat list of sticker squares in the cross layout, in sticker units (the net is 12 x 9).
export function netCells(scramble) {
  const grid = scrambledFaces(scramble);
  const cells = [];
  for (const face of FACES) {
    const [ox, oy] = ORIGIN[face];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        cells.push({ x: ox + c, y: oy + r, color: COLORS[grid[face][r][c]] });
      }
  }
  return cells;
}

export function renderNet(svg, scramble) {
  svg.innerHTML = netCells(scramble)
    .map(
      ({ x, y, color }) =>
        `<rect x="${x + 0.06}" y="${y + 0.06}" width="0.88" height="0.88" rx="0.14" fill="${color}"/>`,
    )
    .join('');
}
