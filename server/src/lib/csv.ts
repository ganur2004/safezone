/** Minimal CSV reader for the FIRMS feed (plain comma-separated, no embedded newlines). */

function splitLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Parses CSV with a header row into row objects. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = lines.shift();
  if (!header) return [];
  const columns = splitLine(header).map((name) => name.trim().toLowerCase());
  return lines.map((line) => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = (values[index] ?? "").trim();
    });
    return row;
  });
}
