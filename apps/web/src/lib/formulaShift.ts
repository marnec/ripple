import { parseCellName, toCellName } from "@ripple/shared/cellRef";

/**
 * Shift cell/range references in a formula string in response to a row/column
 * insert or delete, using Excel semantics.
 *
 * Behavior summary:
 * - Single ref: shifts past the operation point; collapses to `#REF!` if its
 *   row/col falls inside a deleted span.
 * - Range ref: each endpoint shifts independently; an endpoint inside a
 *   deleted span snaps to the surviving edge (low endpoint → `index`, high
 *   endpoint → `index - 1`); whole range collapses to `#REF!` only when both
 *   endpoints fall in the deleted span.
 * - String literals (`"..."`, with `""` as escaped quote) are preserved.
 * - `$` lock markers are preserved on the output but do NOT affect the shift —
 *   Excel adjusts absolute refs on insert/delete; `$` only matters under
 *   fill/copy, which is out of scope here.
 *
 * Out of scope: named ranges, R1C1 notation, sheet-qualified refs
 * (`Sheet1!A1`). Tokens that don't match the A1 grammar pass through verbatim.
 */

export type ShiftOp =
  | { type: "insertRow"; index: number; count: number }
  | { type: "deleteRow"; index: number; count: number }
  | { type: "insertCol"; index: number; count: number }
  | { type: "deleteCol"; index: number; count: number };

const REF_TOKEN = "#REF!";
const CELL_REF_RE = /^(\$?)([A-Z]+)(\$?)(\d+)/;

interface CellTok {
  colLocked: boolean;
  rowLocked: boolean;
  col: number;
  row: number;
}

function tryParseCellRefAt(s: string, pos: number): { tok: CellTok; len: number } | null {
  const m = s.slice(pos).match(CELL_REF_RE);
  if (!m) return null;
  const parsed = parseCellName(m[2] + m[4]);
  if (!parsed) return null;
  // Reject if the next char would make this part of a longer identifier or
  // function call (e.g. "SUM12(" must not be parsed as a cell ref).
  const after = s[pos + m[0].length];
  if (after !== undefined && /[A-Za-z0-9_(]/.test(after)) return null;
  return {
    tok: { colLocked: m[1] === "$", rowLocked: m[3] === "$", col: parsed.col, row: parsed.row },
    len: m[0].length,
  };
}

function emitCellTok(tok: CellTok): string {
  const a1 = toCellName(tok.col, tok.row);
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  if (!m) return REF_TOKEN;
  return (tok.colLocked ? "$" : "") + m[1] + (tok.rowLocked ? "$" : "") + m[2];
}

function shiftAxisValue(value: number, op: ShiftOp): number | null {
  const isInsert = op.type === "insertRow" || op.type === "insertCol";
  if (isInsert) {
    if (value >= op.index) return value + op.count;
    return value;
  }
  if (value < op.index) return value;
  if (value < op.index + op.count) return null;
  return value - op.count;
}

function shiftCellTok(tok: CellTok, op: ShiftOp): CellTok | null {
  const isRow = op.type === "insertRow" || op.type === "deleteRow";
  const cur = isRow ? tok.row : tok.col;
  const next = shiftAxisValue(cur, op);
  if (next === null) return null;
  return isRow ? { ...tok, row: next } : { ...tok, col: next };
}

function shiftRangeTok(start: CellTok, end: CellTok, op: ShiftOp): { start: CellTok; end: CellTok } | null {
  const isRow = op.type === "insertRow" || op.type === "deleteRow";
  const isInsert = op.type === "insertRow" || op.type === "insertCol";

  if (isInsert) {
    const ns = shiftCellTok(start, op);
    const ne = shiftCellTok(end, op);
    if (!ns || !ne) return null;
    return { start: ns, end: ne };
  }

  const startVal = isRow ? start.row : start.col;
  const endVal = isRow ? end.row : end.col;
  const min = Math.min(startVal, endVal);
  const max = Math.max(startVal, endVal);

  // Project each bound onto the post-delete axis. A bound inside the deleted
  // span snaps to the surviving edge (low → index, high → index - 1).
  const shiftLow = (v: number): number => {
    if (v < op.index) return v;
    if (v >= op.index + op.count) return v - op.count;
    return op.index;
  };
  const shiftHigh = (v: number): number => {
    if (v < op.index) return v;
    if (v >= op.index + op.count) return v - op.count;
    return op.index - 1;
  };

  const newMin = shiftLow(min);
  const newMax = shiftHigh(max);
  if (newMin > newMax) return null;

  const startWasMin = startVal <= endVal;
  const newStartVal = startWasMin ? newMin : newMax;
  const newEndVal = startWasMin ? newMax : newMin;

  const ns: CellTok = isRow ? { ...start, row: newStartVal } : { ...start, col: newStartVal };
  const ne: CellTok = isRow ? { ...end, row: newEndVal } : { ...end, col: newEndVal };
  return { start: ns, end: ne };
}

/**
 * Returns the formula string with all A1 references shifted per `op`.
 * If the input does not start with `=`, returns it unchanged.
 */
export function shiftFormula(formula: string, op: ShiftOp): string {
  if (!formula.startsWith("=")) return formula;
  const body = formula.slice(1);
  let pos = 0;
  let out = "=";

  while (pos < body.length) {
    const ch = body[pos];

    if (ch === '"') {
      out += ch;
      pos++;
      while (pos < body.length) {
        const c = body[pos];
        out += c;
        pos++;
        if (c === '"') {
          if (body[pos] === '"') {
            out += '"';
            pos++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (ch === "$" || (ch >= "A" && ch <= "Z")) {
      const ref = tryParseCellRefAt(body, pos);
      if (ref) {
        const afterRef = pos + ref.len;
        if (body[afterRef] === ":") {
          const ref2 = tryParseCellRefAt(body, afterRef + 1);
          if (ref2) {
            const result = shiftRangeTok(ref.tok, ref2.tok, op);
            if (!result) {
              out += REF_TOKEN;
            } else {
              out += emitCellTok(result.start) + ":" + emitCellTok(result.end);
            }
            pos = afterRef + 1 + ref2.len;
            continue;
          }
        }
        const single = shiftCellTok(ref.tok, op);
        out += single ? emitCellTok(single) : REF_TOKEN;
        pos += ref.len;
        continue;
      }
    }

    out += ch;
    pos++;
  }

  return out;
}
