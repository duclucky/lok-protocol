export function clearBigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error("The decryption response did not contain the requested integer value.");
}

export function clearBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const integer = clearBigIntValue(value);
  if (integer === 0n) return false;
  if (integer === 1n) return true;
  throw new Error("The decryption response is not a boolean value.");
}

export function thetaValueToPercent(value: unknown): number {
  const theta = clearBigIntValue(value);
  if (theta < 0n || theta > 4n) throw new Error("The decrypted theta is outside the supported range.");
  return Number(theta) * 25;
}
