/**
 * Parser CSV mínimo (RFC 4180) sin dependencias.
 * Soporta comillas, comas, saltos de línea dentro de comillas, CRLF/LF y BOM.
 */

export interface CsvParseOptions {
  /** Delimitador de una sola posición. Por defecto coma. */
  delimiter?: string;
  /** Recorta espacios al agregar cada campo. Por defecto false. */
  trim?: boolean;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

export function parseCsv(input: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const trim = options.trim ?? false;
  if (delimiter.length !== 1) {
    throw new CsvParseError("El delimitador debe ser exactamente un carácter.");
  }

  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldTouched = false;
  let inQuotes = false;

  const pushField = (): void => {
    row.push(trim ? field.trim() : field);
    field = "";
    fieldTouched = false;
  };

  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          fieldTouched = true;
          index += 1;
        } else {
          inQuotes = false;
          fieldTouched = true;
        }
      } else {
        field += char;
        fieldTouched = true;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
      fieldTouched = true;
    } else if (char === delimiter) {
      pushField();
      fieldTouched = true;
    } else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
      fieldTouched = true;
    }
  }

  if (inQuotes) {
    throw new CsvParseError("Campo entre comillas sin cierre.");
  }

  if (fieldTouched || row.length > 0) {
    pushRow();
  }

  return rows;
}

/**
 * Interpreta la primera fila como header. Ignora filas totalmente vacías.
 * No reordena ni renombra columnas: el resolver de los adapters se encarga.
 */
export function parseCsvTable(input: string, options: CsvParseOptions = {}): CsvTable {
  const parsed = parseCsv(input, options);
  if (parsed.length === 0) return { header: [], rows: [] };

  const [header, ...body] = parsed;
  const rows = body.filter((row) => row.some((cell) => cell.trim().length > 0));
  return { header, rows };
}

/** Convierte una tabla en registros por nombre de columna. */
export function tableToRecords(table: CsvTable): Array<Record<string, string>> {
  return table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.header.forEach((column, index) => {
      record[column] = row[index] ?? "";
    });
    return record;
  });
}
