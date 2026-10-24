export function equal(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} verwacht ${e}, kreeg ${a}`.trim());
}

export function ok(value, message = 'verwacht waar') {
  if (!value) throw new Error(message);
}
