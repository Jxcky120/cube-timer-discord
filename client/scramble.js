const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const MODS = ['', "'", '2'];
const AXIS = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 };

// Random-move 3x3 scramble: no repeated face, and no A B A on the same axis.
export function generateScramble(length = 20) {
  const moves = [];
  let last, prev;
  while (moves.length < length) {
    const face = FACES[Math.floor(Math.random() * FACES.length)];
    if (face === last) continue;
    if (last && AXIS[face] === AXIS[last] && face === prev) continue;
    moves.push(face + MODS[Math.floor(Math.random() * MODS.length)]);
    prev = last;
    last = face;
  }
  return moves.join(' ');
}
