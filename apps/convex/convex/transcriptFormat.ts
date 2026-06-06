/**
 * Pure conversion of Cloudflare RealtimeKit's transcript download into the
 * markdown we seed a document from. Kept free of `"use node"` and the
 * BlockNote/JSDOM deps so it can be unit-tested in isolation (see
 * `tests/transcriptFormat.test.ts`); `transcripts.ts` imports it.
 *
 * The download format isn't guaranteed — Cloudflare currently returns CSV
 * (`transcript.csv`), but JSON / VTT / SRT / plain text are all possible — so we
 * take a `hint` (derived from the URL extension) and also sniff. Each utterance
 * becomes its own paragraph with the speaker bolded (`**Name:** text`).
 */
export type TranscriptHint = "csv" | "json" | "vtt" | "srt" | undefined;

export function transcriptToMarkdown(raw: string, hint?: TranscriptHint): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (hint === "csv") return csvTranscriptToMarkdown(trimmed);

  // JSON (array of entries, or an object wrapping one).
  if (hint === "json" || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const md = jsonTranscriptToMarkdown(JSON.parse(trimmed));
      if (md) return md;
    } catch {
      // not JSON — fall through
    }
  }

  // WebVTT / SRT: cues separated by blank lines, each with a `-->` timing line.
  if (hint === "vtt" || hint === "srt" || trimmed.includes("-->")) {
    return cueTranscriptToMarkdown(trimmed);
  }

  // Last resort: if it smells like CSV (header row with a known column), parse it.
  if (looksLikeCsv(trimmed)) return csvTranscriptToMarkdown(trimmed);

  return trimmed;
}

/**
 * Derive a format hint from a transcript download URL's file extension.
 * Cloudflare's URL carries the format (`…/transcript.csv`), so this seeds
 * `transcriptToMarkdown`'s `hint` before it falls back to content sniffing.
 */
export function hintFromUrl(url: string): TranscriptHint {
  const lower = url.toLowerCase();
  if (lower.includes(".csv")) return "csv";
  if (lower.includes(".vtt")) return "vtt";
  if (lower.includes(".srt")) return "srt";
  if (lower.includes(".json")) return "json";
  return undefined;
}

type TranscriptEntry = {
  name?: string;
  speaker?: string;
  speakerName?: string;
  participantName?: string;
  transcript?: string;
  text?: string;
};

function entryToLine(e: TranscriptEntry): string | null {
  const speaker = e.name ?? e.speakerName ?? e.participantName ?? e.speaker;
  const text = (e.transcript ?? e.text ?? "").trim();
  if (!text) return null;
  return speaker ? `**${speaker}:** ${text}` : text;
}

function jsonTranscriptToMarkdown(parsed: unknown): string {
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { transcripts?: unknown[] })?.transcripts)
      ? (parsed as { transcripts: unknown[] }).transcripts
      : Array.isArray((parsed as { data?: unknown[] })?.data)
        ? (parsed as { data: unknown[] }).data
        : [];

  if (list.length > 0) {
    const lines = list
      .map((e) =>
        typeof e === "object" && e !== null
          ? entryToLine(e as TranscriptEntry)
          : null,
      )
      .filter((l): l is string => l !== null);
    return lines.join("\n\n");
  }

  const flat = (parsed as { transcript?: string })?.transcript;
  return typeof flat === "string" ? flat.trim() : "";
}

function cueTranscriptToMarkdown(raw: string): string {
  const blocks = raw.replace(/^WEBVTT.*$/im, "").split(/\n\s*\n/);
  const lines: string[] = [];
  for (const block of blocks) {
    const textLines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.includes("-->") && // timing line
          !/^\d+$/.test(l), // SRT cue index
      )
      .map((l) =>
        l
          .replace(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/i, "**$1:** $2")
          .replace(/<\/?[^>]+>/g, ""),
      );
    if (textLines.length > 0) lines.push(textLines.join(" "));
  }
  return lines.join("\n\n");
}

// --- CSV --------------------------------------------------------------------

const NAME_COL = /name|speaker|participant|display|user/i;
const TEXT_COL = /transcript|text|content|message|caption|words?/i;

function looksLikeCsv(raw: string): boolean {
  const firstLine = raw.split("\n", 1)[0] ?? "";
  return firstLine.includes(",") && (NAME_COL.test(firstLine) || TEXT_COL.test(firstLine));
}

/**
 * RFC-4180-ish CSV parse — handles double-quoted fields containing commas,
 * newlines, and escaped quotes (`""`). Transcript text routinely contains
 * commas, so a naive split would mangle it.
 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

/** A row of values (timestamps, ids) rather than column-name labels. */
function looksLikeDataRow(row: string[]): boolean {
  return row.some((f) => {
    const t = f.trim();
    return /^\d{10,}$/.test(t) || UUID_RE.test(t);
  });
}

function csvTranscriptToMarkdown(raw: string): string {
  const rows = parseCsv(raw).filter((r) => r.some((c) => c.trim().length > 0));
  if (rows.length === 0) return "";

  const first = rows[0];
  // RealtimeKit's transcript CSV is HEADERLESS — every row is data, columns are
  // [timestamp, sessionId, peerId, participantId, name, transcript]. Only treat
  // row 0 as a header if it's clearly column labels (not timestamps/uuids) AND
  // names a speaker + text column; otherwise the first utterance gets eaten.
  const headerDetected =
    !looksLikeDataRow(first) &&
    first.some((h) => NAME_COL.test(h)) &&
    first.some((h) => TEXT_COL.test(h));

  let nameIdx: number;
  let textIdx: number;
  let dataRows: string[][];
  if (headerDetected) {
    const header = first.map((h) => h.trim().toLowerCase());
    nameIdx = header.findIndex((h) => NAME_COL.test(h));
    textIdx = header.findIndex((h) => TEXT_COL.test(h));
    if (textIdx < 0) textIdx = first.length - 1;
    dataRows = rows.slice(1);
  } else {
    // Headerless: transcript text is the last column, speaker the one before.
    textIdx = first.length - 1;
    nameIdx = first.length >= 2 ? first.length - 2 : -1;
    dataRows = rows;
  }

  const lines = dataRows
    .map((r) => {
      const text = (r[textIdx] ?? "").trim();
      if (!text) return null;
      const name = nameIdx >= 0 ? (r[nameIdx] ?? "").trim() : "";
      return name ? `**${name}:** ${text}` : text;
    })
    .filter((l): l is string => l !== null);

  return lines.join("\n\n");
}
