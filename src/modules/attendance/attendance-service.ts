import { google } from "googleapis";
import { env } from "../../config/env";

export type AttendanceEventType = "Conference" | "Workshop";

type Attendee = {
  name?: string;
  email?: string;
  ticketId?: string;
};

type MarkAttendanceInput = {
  spreadsheetId: string;
  range: string;
  clientEmail: string;
  privateKey: string;
  eventType: AttendanceEventType;
  attendedValue?: string;
  attendee: Attendee;
};

function normalize(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function columnLetter(index1Based: number) {
  let n = index1Based;
  let result = "";

  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result;
}

function sheetNameFromRange(range: string) {
  const idx = range.indexOf("!");
  return idx >= 0 ? range.slice(0, idx) : range;
}

function rowContains(row: string[], expected?: string) {
  const target = normalize(expected);
  if (!target) {
    return false;
  }

  return row.some((cell) => normalize(cell) === target);
}

function findAttendanceColumn(headers: string[], eventType: AttendanceEventType) {
  const normalizedEventType = normalize(eventType);
  const candidates = new Set([
    normalizedEventType,
    `${normalizedEventType} attended`,
    `${normalizedEventType} attendance`,
    `attended ${normalizedEventType}`,
  ]);

  return headers.findIndex((header) => candidates.has(normalize(header)));
}

function findMatchingRowIndex(rows: string[][], attendee: Attendee) {
  const matchers: Array<keyof Attendee> = ["ticketId", "email", "name"];

  for (const field of matchers) {
    const expected = attendee[field];
    if (!normalize(expected)) {
      continue;
    }

    const rowIndex = rows.findIndex((row) => rowContains(row, expected));
    if (rowIndex >= 0) {
      return {
        rowIndex,
        matchedBy: field,
      };
    }
  }

  return null;
}

export async function markAttendanceInSheet(input: MarkAttendanceInput) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: input.clientEmail,
      private_key: input.privateKey.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range: input.range,
  });

  const rows = readRes.data.values ?? [];
  if (rows.length === 0) {
    throw new Error("Google Sheet is empty.");
  }

  const headers = rows[0];
  const targetColumnIndex = findAttendanceColumn(headers, input.eventType);
  if (targetColumnIndex < 0) {
    throw new Error(`Could not find attendance column for ${input.eventType}.`);
  }

  const bodyRows = rows.slice(1);
  const match = findMatchingRowIndex(bodyRows, input.attendee);
  if (!match) {
    throw new Error("No matching attendee row found in Google Sheets.");
  }

  const actualSheetRow = match.rowIndex + 2;
  const cell = `${sheetNameFromRange(input.range)}!${columnLetter(targetColumnIndex + 1)}${actualSheetRow}`;
  const value = input.attendedValue || "Attended";

  const updateRes = await sheets.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range: cell,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[value]],
    },
  });

  return {
    rowNumber: actualSheetRow,
    column: headers[targetColumnIndex],
    cell,
    value,
    matchedBy: match.matchedBy,
    updatedCells: updateRes.data.updatedCells ?? 0,
  };
}

export async function acceptAttendance(input: {
  eventType: AttendanceEventType;
  attendee: {
    name?: string;
    email?: string;
    ticketId: string;
  };
}) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SHEETS_CLIENT_EMAIL || !env.GOOGLE_SHEETS_PRIVATE_KEY) {
    throw new Error("Google Sheets attendance integration is not configured.");
  }

  return markAttendanceInSheet({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: env.GOOGLE_SHEETS_RANGE,
    clientEmail: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    privateKey: env.GOOGLE_SHEETS_PRIVATE_KEY,
    attendedValue: env.GOOGLE_SHEETS_ATTENDED_VALUE,
    eventType: input.eventType,
    attendee: input.attendee,
  });
}
