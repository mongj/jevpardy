import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../shared/constants.ts";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling keeps the distribution uniform.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

export function randomId(length: number): string {
  return randomFrom(ID_ALPHABET, length);
}

export function randomRoomCode(): string {
  return randomFrom(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);
}

export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function log(level: "info" | "warn" | "error", message: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
