const crypto = require('crypto');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const cost = 16384;
  const blockSize = 8;
  const parallelization = 1;
  const derived = crypto.scryptSync(password, salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${cost}$${blockSize}$${parallelization}$${base64url(salt)}$${base64url(derived)}`;
}

function verifyScryptPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (!Number.isInteger(cost) || cost < 8192 || cost > 1048576) return false;
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 32) return false;
  if (!Number.isInteger(parallelization) || parallelization < 1 || parallelization > 16) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const derived = crypto.scryptSync(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyScryptPassword };
