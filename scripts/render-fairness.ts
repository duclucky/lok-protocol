import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import type { FairnessReport, FairnessScenarioReport } from "./run-fairness";

const WIDTH = 1600;
const HEIGHT = 1200;
type Color = readonly [number, number, number, number];

const COLORS = {
  background: [248, 250, 252, 255] as const,
  panel: [255, 255, 255, 255] as const,
  foreground: [30, 41, 59, 255] as const,
  muted: [100, 116, 139, 255] as const,
  grid: [203, 213, 225, 255] as const,
  expected: [37, 99, 235, 255] as const,
  observed: [249, 115, 22, 255] as const,
  pass: [21, 128, 61, 255] as const,
  fail: [185, 28, 28, 255] as const,
};

const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
};

function setPixel(pixels: Buffer, x: number, y: number, color: Color): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

function fillRect(pixels: Buffer, x: number, y: number, width: number, height: number, color: Color): void {
  for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(WIDTH, x + width); column += 1) {
      setPixel(pixels, column, row, color);
    }
  }
}

function line(pixels: Buffer, x1: number, y1: number, x2: number, y2: number, color: Color, thickness = 1): void {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / Math.max(1, steps));
    const y = Math.round(y1 + ((y2 - y1) * step) / Math.max(1, steps));
    fillRect(pixels, x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
  }
}

function text(pixels: Buffer, value: string, x: number, y: number, scale: number, color: Color): void {
  let cursor = x;
  for (const character of value.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") fillRect(pixels, cursor + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
  }
}

function panel(pixels: Buffer, scenario: FairnessScenarioReport, x: number, y: number): void {
  const width = 710;
  const height = 430;
  fillRect(pixels, x, y, width, height, COLORS.panel);
  line(pixels, x, y, x + width, y, COLORS.grid, 2);
  line(pixels, x, y + height, x + width, y + height, COLORS.grid, 2);
  line(pixels, x, y, x, y + height, COLORS.grid, 2);
  line(pixels, x + width, y, x + width, y + height, COLORS.grid, 2);

  text(pixels, scenario.id, x + 24, y + 20, 3, COLORS.foreground);
  text(pixels, `${scenario.proposition}  N=${scenario.draws}`, x + 24, y + 50, 2, COLORS.muted);
  text(
    pixels,
    `P=${scenario.pValue.toFixed(4)}  ${scenario.status}`,
    x + 430,
    y + 50,
    2,
    scenario.status === "PASS" ? COLORS.pass : COLORS.fail,
  );

  const plotX = x + 58;
  const plotY = y + 92;
  const plotWidth = 620;
  const plotHeight = 250;
  const maxProbability = Math.max(
    ...scenario.participants.flatMap(({ confidenceInterval99, observedProbability }) => [
      confidenceInterval99.upper,
      observedProbability,
    ]),
  );
  const ceiling = maxProbability * 1.08;
  for (let grid = 0; grid <= 4; grid += 1) {
    const gridY = plotY + Math.round((plotHeight * grid) / 4);
    line(pixels, plotX, gridY, plotX + plotWidth, gridY, COLORS.grid);
  }

  const groupWidth = plotWidth / scenario.participants.length;
  scenario.participants.forEach((participant, index) => {
    const center = plotX + groupWidth * (index + 0.5);
    const expectedHeight = Math.round((participant.expectedProbability / ceiling) * plotHeight);
    const observedHeight = Math.round((participant.observedProbability / ceiling) * plotHeight);
    const expectedX = Math.round(center - 19);
    const observedX = Math.round(center + 2);
    fillRect(pixels, expectedX, plotY + plotHeight - expectedHeight, 16, expectedHeight, COLORS.expected);
    fillRect(pixels, observedX, plotY + plotHeight - observedHeight, 16, observedHeight, COLORS.observed);

    const lowerY = plotY + plotHeight - Math.round((participant.confidenceInterval99.lower / ceiling) * plotHeight);
    const upperY = plotY + plotHeight - Math.round((participant.confidenceInterval99.upper / ceiling) * plotHeight);
    line(pixels, Math.round(center), lowerY, Math.round(center), upperY, COLORS.foreground, 2);
    line(pixels, Math.round(center - 5), lowerY, Math.round(center + 5), lowerY, COLORS.foreground, 2);
    line(pixels, Math.round(center - 5), upperY, Math.round(center + 5), upperY, COLORS.foreground, 2);
    text(pixels, `P${index + 1}`, Math.round(center - 8), plotY + plotHeight + 14, 1, COLORS.muted);
  });

  text(pixels, "EXPECTED", x + 24, y + 388, 2, COLORS.expected);
  text(pixels, "OBSERVED", x + 170, y + 388, 2, COLORS.observed);
  text(pixels, "WHISKER=SIMULTANEOUS 99% CI", x + 330, y + 388, 2, COLORS.muted);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(pixels: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const destination = y * (WIDTH * 4 + 1);
    scanlines[destination] = 0;
    pixels.copy(scanlines, destination + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderFairnessPng(report: FairnessReport, outputPath: string): void {
  if (report.scenarios.length !== 4) throw new Error("fairness chart requires exactly four scenarios");
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  fillRect(pixels, 0, 0, WIDTH, HEIGHT, COLORS.background);
  text(pixels, "LOK FAIRNESS EVIDENCE", 60, 42, 5, COLORS.foreground);
  text(pixels, "P-F1 + P-F1'  4,000,000 DRAWS", 60, 92, 3, COLORS.muted);
  text(pixels, report.status, 1370, 58, 4, report.status === "PASS" ? COLORS.pass : COLORS.fail);

  const placements = [
    [60, 150],
    [830, 150],
    [60, 620],
    [830, 620],
  ] as const;
  report.scenarios.forEach((scenario, index) => panel(pixels, scenario, placements[index][0], placements[index][1]));
  text(
    pixels,
    "FULL PARTICIPANT LABELS, COUNTS, SEEDS AND CI VALUES: ARTIFACTS/FAIRNESS.JSON",
    60,
    1090,
    2,
    COLORS.muted,
  );
  text(
    pixels,
    "RAW UNIFORMITY IS THE ZAMA P-F4 TRUST BOUNDARY; LOK TESTS MAPPING AND MODULO REDUCTION",
    60,
    1125,
    2,
    COLORS.muted,
  );

  const resolved = path.resolve(outputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, encodePng(pixels));
}

if (require.main === module) {
  const input = path.resolve(process.env.LOK_FAIRNESS_INPUT ?? path.join("artifacts", "fairness.json"));
  const output = path.resolve(process.env.LOK_FAIRNESS_PNG ?? path.join("artifacts", "fairness.png"));
  const report = JSON.parse(readFileSync(input, "utf8")) as FairnessReport;
  renderFairnessPng(report, output);
  console.log(`Rendered ${output}`);
}
