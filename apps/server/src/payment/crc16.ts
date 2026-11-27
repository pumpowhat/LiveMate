export function crc16ccitt(input: string): string {
  let crc = 0xffff;

  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;

    for (let bit = 0; bit < 8; bit++) {
      const polynomial = (crc & 0x8000) !== 0 ? 0x1021 : 0;
      crc = ((crc << 1) ^ polynomial) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}
