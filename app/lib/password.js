const crypto = require('crypto');

const MIN_LENGTH = 8;
// bcrypt silently ignores anything past 72 bytes, so this is a real ceiling,
// not an arbitrary one — comfortably above any sane password length though.
const MAX_LENGTH = 64;

// Auto-generated passwords default to 12-16 characters. 8 remains the
// enforced floor for passwords people choose themselves, but longer is
// meaningfully more resistant to cracking even with the same character
// variety, so generated ones default higher.
const GENERATED_MIN = 12;
const GENERATED_MAX = 16;

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no O/I to avoid confusion with 0/1
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789'; // no 0/1 to avoid confusion with O/l
const SYMBOLS = '!@#$%^&*';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function randomInt(max) {
  return crypto.randomInt(max);
}

function randomChar(charset) {
  return charset[randomInt(charset.length)];
}

// Generates a password that always satisfies the policy below:
// at least 8 characters (defaults to 12-16), with at least one uppercase,
// one lowercase, one digit, and one symbol.
function generatePassword() {
  const length = GENERATED_MIN + randomInt(GENERATED_MAX - GENERATED_MIN + 1);

  // Guarantee one of each required character class...
  const required = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS), randomChar(SYMBOLS)];

  // ...then fill the rest randomly from the full set.
  const rest = Array.from({ length: length - required.length }, () => randomChar(ALL));

  const chars = [...required, ...rest];

  // Shuffle so the required characters aren't always in the same position.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

// Validates a user-chosen password against the same policy.
// Returns { valid: boolean, message: string|null }
function validatePassword(password) {
  if (!password || password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    return { valid: false, message: `Password must be ${MIN_LENGTH}-${MAX_LENGTH} characters long.` };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must include at least one number.' };
  }
  if (!/[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(password)) {
    return { valid: false, message: 'Password must include at least one symbol (e.g. ! @ # $ %).' };
  }
  return { valid: true, message: null };
}

module.exports = { generatePassword, validatePassword, MIN_LENGTH, MAX_LENGTH };
