export const ansi = {
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  faint: "\x1b[2m",
  purple: "\x1b[38;5;99m",
  orange: "\x1b[38;5;208m",
  gray: "\x1b[38;5;245m",
};

export type TerminalSize = {
  columns: number;
  rows: number;
};

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

export function visibleLength(value: string): number {
  let width = 0;
  for (const char of stripAnsi(value)) {
    width += charWidth(char);
  }
  return width;
}

export function clip(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const plain = stripAnsi(value);
  if (visibleLength(plain) <= width) {
    return value;
  }
  if (width <= 3) {
    return clipPlainText(plain, width);
  }
  return `${clipPlainText(plain, width - 3)}...`;
}

export function center(value: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleLength(value)) / 2));
  return `${" ".repeat(pad)}${value}`;
}

export function padRight(value: string, width: number): string {
  const clipped = clip(value, width);
  const pad = Math.max(0, width - visibleLength(clipped));
  return `${clipped}${" ".repeat(pad)}`;
}

function clipPlainText(value: string, width: number): string {
  let used = 0;
  let result = "";
  for (const char of value) {
    const next = charWidth(char);
    if (used + next > width) {
      break;
    }
    used += next;
    result += char;
  }
  return result;
}

function charWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (isCombiningCodePoint(codePoint)) {
    return 0;
  }
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  );
}
