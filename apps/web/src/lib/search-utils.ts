export type ParsedSearch = {
  searchText: string;
  tags: string[];
};

export function parseSearchInput(input: string): ParsedSearch {
  const parts = input.split(/\s+/);
  const tags: string[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.startsWith("#") && part.length > 1) {
      tags.push(part.slice(1).toLowerCase());
    } else if (part) {
      textParts.push(part);
    }
  }

  return {
    searchText: textParts.join(" "),
    tags,
  };
}

export function buildSearchString(searchText: string, tags: string[]): string {
  const parts: string[] = [];
  if (searchText) parts.push(searchText);
  for (const tag of tags) {
    parts.push(`#${tag}`);
  }
  return parts.join(" ");
}
