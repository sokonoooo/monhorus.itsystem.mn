/**
 * Generates a temporary passcode that satisfies the backend policy (>= 10 chars,
 * at least one letter and one digit) using the platform CSPRNG.
 *
 * Ambiguous glyphs (O/0, I/l/1) are excluded because these passcodes get read aloud
 * or copied off a screen by hand when an admin hands one to a field technician.
 */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

export function generatePasscode(): string {
  const letterCount = 11;
  const digitCount = 3;
  const bytes = new Uint32Array(letterCount + digitCount);
  crypto.getRandomValues(bytes);

  const chars: string[] = [];
  for (let index = 0; index < letterCount; index += 1) {
    chars.push(LETTERS[bytes[index]! % LETTERS.length]!);
  }
  for (let index = letterCount; index < bytes.length; index += 1) {
    chars.push(DIGITS[bytes[index]! % DIGITS.length]!);
  }

  return chars.join('');
}
