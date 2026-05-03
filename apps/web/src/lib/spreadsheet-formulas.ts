export interface FormulaDefinition {
  name: string;
  description: string;
  syntax: string;
  category:
    | "math"
    | "statistical"
    | "text"
    | "logical"
    | "date"
    | "lookup"
    | "financial"
    | "info";
}

export const SPREADSHEET_FORMULAS: FormulaDefinition[] = [
  // Math
  { name: "ABS", description: "Returns the absolute value of a number", syntax: "ABS(number)", category: "math" },
  { name: "CEILING", description: "Rounds a number up to the nearest multiple", syntax: "CEILING(number, significance)", category: "math" },
  { name: "FLOOR", description: "Rounds a number down to the nearest multiple", syntax: "FLOOR(number, significance)", category: "math" },
  { name: "INT", description: "Rounds a number down to the nearest integer", syntax: "INT(number)", category: "math" },
  { name: "MOD", description: "Returns the remainder after division", syntax: "MOD(number, divisor)", category: "math" },
  { name: "POWER", description: "Returns a number raised to a power", syntax: "POWER(number, power)", category: "math" },
  { name: "PRODUCT", description: "Multiplies all the numbers given as arguments", syntax: "PRODUCT(number1, [number2], ...)", category: "math" },
  { name: "ROUND", description: "Rounds a number to a specified number of digits", syntax: "ROUND(number, num_digits)", category: "math" },
  { name: "ROUNDDOWN", description: "Rounds a number down toward zero", syntax: "ROUNDDOWN(number, num_digits)", category: "math" },
  { name: "ROUNDUP", description: "Rounds a number up away from zero", syntax: "ROUNDUP(number, num_digits)", category: "math" },
  { name: "SQRT", description: "Returns the square root of a number", syntax: "SQRT(number)", category: "math" },
  { name: "SUBTOTAL", description: "Returns a subtotal in a list or database", syntax: "SUBTOTAL(function_num, ref1, ...)", category: "math" },
  { name: "SUM", description: "Adds all the numbers in a range of cells", syntax: "SUM(number1, [number2], ...)", category: "math" },
  { name: "SUMIF", description: "Adds cells that meet a given condition", syntax: "SUMIF(range, criteria, [sum_range])", category: "math" },
  { name: "SUMIFS", description: "Adds cells that meet multiple conditions", syntax: "SUMIFS(sum_range, range1, criteria1, ...)", category: "math" },
  { name: "SUMPRODUCT", description: "Returns the sum of products of corresponding ranges", syntax: "SUMPRODUCT(array1, [array2], ...)", category: "math" },

  // Statistical
  { name: "AVERAGE", description: "Returns the arithmetic mean of arguments", syntax: "AVERAGE(number1, [number2], ...)", category: "statistical" },
  { name: "AVERAGEIF", description: "Averages cells that meet a condition", syntax: "AVERAGEIF(range, criteria, [average_range])", category: "statistical" },
  { name: "AVERAGEIFS", description: "Averages cells that meet multiple conditions", syntax: "AVERAGEIFS(average_range, range1, criteria1, ...)", category: "statistical" },
  { name: "COUNT", description: "Counts cells that contain numbers", syntax: "COUNT(value1, [value2], ...)", category: "statistical" },
  { name: "COUNTA", description: "Counts cells that are not empty", syntax: "COUNTA(value1, [value2], ...)", category: "statistical" },
  { name: "COUNTBLANK", description: "Counts empty cells in a range", syntax: "COUNTBLANK(range)", category: "statistical" },
  { name: "COUNTIF", description: "Counts cells that meet a condition", syntax: "COUNTIF(range, criteria)", category: "statistical" },
  { name: "COUNTIFS", description: "Counts cells that meet multiple conditions", syntax: "COUNTIFS(range1, criteria1, [range2], ...)", category: "statistical" },
  { name: "MAX", description: "Returns the largest value in a set", syntax: "MAX(number1, [number2], ...)", category: "statistical" },
  { name: "MEDIAN", description: "Returns the median of the given numbers", syntax: "MEDIAN(number1, [number2], ...)", category: "statistical" },
  { name: "MIN", description: "Returns the smallest value in a set", syntax: "MIN(number1, [number2], ...)", category: "statistical" },
  { name: "MODE", description: "Returns the most frequently occurring value", syntax: "MODE(number1, [number2], ...)", category: "statistical" },
  { name: "PERCENTILE", description: "Returns the k-th percentile of values", syntax: "PERCENTILE(array, k)", category: "statistical" },
  { name: "RANK", description: "Returns the rank of a number in a list", syntax: "RANK(number, ref, [order])", category: "statistical" },
  { name: "STDEV", description: "Estimates standard deviation based on a sample", syntax: "STDEV(number1, [number2], ...)", category: "statistical" },
  { name: "VAR", description: "Estimates variance based on a sample", syntax: "VAR(number1, [number2], ...)", category: "statistical" },

  // Text
  { name: "CONCAT", description: "Joins several text strings into one", syntax: "CONCAT(text1, [text2], ...)", category: "text" },
  { name: "CONCATENATE", description: "Joins several text strings into one", syntax: "CONCATENATE(text1, [text2], ...)", category: "text" },
  { name: "EXACT", description: "Checks whether two text strings are identical", syntax: "EXACT(text1, text2)", category: "text" },
  { name: "FIND", description: "Finds one text string within another (case-sensitive)", syntax: "FIND(find_text, within_text, [start_num])", category: "text" },
  { name: "LEFT", description: "Returns the leftmost characters from a text", syntax: "LEFT(text, [num_chars])", category: "text" },
  { name: "LEN", description: "Returns the number of characters in a text", syntax: "LEN(text)", category: "text" },
  { name: "LOWER", description: "Converts text to lowercase", syntax: "LOWER(text)", category: "text" },
  { name: "MID", description: "Returns characters from the middle of a text", syntax: "MID(text, start_num, num_chars)", category: "text" },
  { name: "PROPER", description: "Capitalizes the first letter of each word", syntax: "PROPER(text)", category: "text" },
  { name: "REPT", description: "Repeats text a given number of times", syntax: "REPT(text, number_times)", category: "text" },
  { name: "RIGHT", description: "Returns the rightmost characters from a text", syntax: "RIGHT(text, [num_chars])", category: "text" },
  { name: "SEARCH", description: "Finds one text string within another (case-insensitive)", syntax: "SEARCH(find_text, within_text, [start_num])", category: "text" },
  { name: "SUBSTITUTE", description: "Substitutes new text for old text in a string", syntax: "SUBSTITUTE(text, old_text, new_text, [instance_num])", category: "text" },
  { name: "TEXT", description: "Formats a number as text with a given format", syntax: "TEXT(value, format_text)", category: "text" },
  { name: "TEXTJOIN", description: "Joins text with a delimiter between each", syntax: "TEXTJOIN(delimiter, ignore_empty, text1, ...)", category: "text" },
  { name: "TRIM", description: "Removes extra spaces from text", syntax: "TRIM(text)", category: "text" },
  { name: "UPPER", description: "Converts text to uppercase", syntax: "UPPER(text)", category: "text" },
  { name: "VALUE", description: "Converts a text string to a number", syntax: "VALUE(text)", category: "text" },

  // Logical
  { name: "AND", description: "Returns TRUE if all arguments are true", syntax: "AND(logical1, [logical2], ...)", category: "logical" },
  { name: "FALSE", description: "Returns the logical value FALSE", syntax: "FALSE()", category: "logical" },
  { name: "IF", description: "Returns one value if true, another if false", syntax: "IF(logical_test, value_if_true, [value_if_false])", category: "logical" },
  { name: "IFERROR", description: "Returns a value if no error, else an alternate", syntax: "IFERROR(value, value_if_error)", category: "logical" },
  { name: "IFNA", description: "Returns a value if not #N/A, else an alternate", syntax: "IFNA(value, value_if_na)", category: "logical" },
  { name: "IFS", description: "Checks multiple conditions and returns corresponding values", syntax: "IFS(logical_test1, value1, [logical_test2, value2], ...)", category: "logical" },
  { name: "NOT", description: "Reverses the logic of its argument", syntax: "NOT(logical)", category: "logical" },
  { name: "OR", description: "Returns TRUE if any argument is true", syntax: "OR(logical1, [logical2], ...)", category: "logical" },
  { name: "SWITCH", description: "Evaluates an expression against a list of values", syntax: "SWITCH(expression, value1, result1, [default])", category: "logical" },
  { name: "TRUE", description: "Returns the logical value TRUE", syntax: "TRUE()", category: "logical" },

  // Date
  { name: "DATE", description: "Creates a date from year, month, and day", syntax: "DATE(year, month, day)", category: "date" },
  { name: "DATEVALUE", description: "Converts a date text string to a date value", syntax: "DATEVALUE(date_text)", category: "date" },
  { name: "DAY", description: "Returns the day of the month of a date", syntax: "DAY(serial_number)", category: "date" },
  { name: "DAYS", description: "Returns the number of days between two dates", syntax: "DAYS(end_date, start_date)", category: "date" },
  { name: "EDATE", description: "Returns a date a given number of months away", syntax: "EDATE(start_date, months)", category: "date" },
  { name: "EOMONTH", description: "Returns the last day of the month offset by months", syntax: "EOMONTH(start_date, months)", category: "date" },
  { name: "HOUR", description: "Returns the hour of a time value", syntax: "HOUR(serial_number)", category: "date" },
  { name: "MINUTE", description: "Returns the minute of a time value", syntax: "MINUTE(serial_number)", category: "date" },
  { name: "MONTH", description: "Returns the month of a date", syntax: "MONTH(serial_number)", category: "date" },
  { name: "NETWORKDAYS", description: "Returns the number of working days between two dates", syntax: "NETWORKDAYS(start_date, end_date, [holidays])", category: "date" },
  { name: "NOW", description: "Returns the current date and time", syntax: "NOW()", category: "date" },
  { name: "SECOND", description: "Returns the second of a time value", syntax: "SECOND(serial_number)", category: "date" },
  { name: "TODAY", description: "Returns the current date", syntax: "TODAY()", category: "date" },
  { name: "WEEKDAY", description: "Returns the day of the week of a date", syntax: "WEEKDAY(serial_number, [return_type])", category: "date" },
  { name: "WEEKNUM", description: "Returns the week number of a date", syntax: "WEEKNUM(serial_number, [return_type])", category: "date" },
  { name: "YEAR", description: "Returns the year of a date", syntax: "YEAR(serial_number)", category: "date" },

  // Lookup
  { name: "CHOOSE", description: "Chooses a value from a list based on index", syntax: "CHOOSE(index_num, value1, [value2], ...)", category: "lookup" },
  { name: "COLUMN", description: "Returns the column number of a reference", syntax: "COLUMN([reference])", category: "lookup" },
  { name: "COLUMNS", description: "Returns the number of columns in a reference", syntax: "COLUMNS(array)", category: "lookup" },
  { name: "HLOOKUP", description: "Looks for a value in the top row and returns a value", syntax: "HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])", category: "lookup" },
  { name: "INDEX", description: "Returns a value at a given position in a range", syntax: "INDEX(array, row_num, [column_num])", category: "lookup" },
  { name: "LOOKUP", description: "Looks up a value in a range", syntax: "LOOKUP(lookup_value, lookup_vector, [result_vector])", category: "lookup" },
  { name: "MATCH", description: "Returns the position of a value in a range", syntax: "MATCH(lookup_value, lookup_array, [match_type])", category: "lookup" },
  { name: "ROW", description: "Returns the row number of a reference", syntax: "ROW([reference])", category: "lookup" },
  { name: "ROWS", description: "Returns the number of rows in a reference", syntax: "ROWS(array)", category: "lookup" },
  { name: "TRANSPOSE", description: "Returns the transpose of an array", syntax: "TRANSPOSE(array)", category: "lookup" },
  { name: "VLOOKUP", description: "Looks for a value in the first column and returns a value", syntax: "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])", category: "lookup" },

  // Financial
  { name: "FV", description: "Returns the future value of an investment", syntax: "FV(rate, nper, pmt, [pv], [type])", category: "financial" },
  { name: "IRR", description: "Returns the internal rate of return", syntax: "IRR(values, [guess])", category: "financial" },
  { name: "NPER", description: "Returns the number of periods for an investment", syntax: "NPER(rate, pmt, pv, [fv], [type])", category: "financial" },
  { name: "NPV", description: "Returns the net present value of an investment", syntax: "NPV(rate, value1, [value2], ...)", category: "financial" },
  { name: "PMT", description: "Returns the periodic payment for a loan", syntax: "PMT(rate, nper, pv, [fv], [type])", category: "financial" },
  { name: "PV", description: "Returns the present value of an investment", syntax: "PV(rate, nper, pmt, [fv], [type])", category: "financial" },
  { name: "RATE", description: "Returns the interest rate per period", syntax: "RATE(nper, pmt, pv, [fv], [type], [guess])", category: "financial" },

  // Info
  { name: "ISBLANK", description: "Returns TRUE if the value is blank", syntax: "ISBLANK(value)", category: "info" },
  { name: "ISERROR", description: "Returns TRUE if the value is an error", syntax: "ISERROR(value)", category: "info" },
  { name: "ISNUMBER", description: "Returns TRUE if the value is a number", syntax: "ISNUMBER(value)", category: "info" },
  { name: "ISTEXT", description: "Returns TRUE if the value is text", syntax: "ISTEXT(value)", category: "info" },
];

/**
 * Filter formulas by a query string (the text after "=").
 * Prefers startsWith matches; falls back to includes if none match.
 */
export function filterFormulas(query: string): FormulaDefinition[] {
  if (!query) return SPREADSHEET_FORMULAS;
  const q = query.toUpperCase();
  const starts = SPREADSHEET_FORMULAS.filter((f) => f.name.startsWith(q));
  return starts.length > 0
    ? starts
    : SPREADSHEET_FORMULAS.filter((f) => f.name.includes(q));
}
