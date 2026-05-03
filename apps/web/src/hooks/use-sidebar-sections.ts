import { useState } from "react";

const COOKIE_NAME = "sidebar:sections";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

type SectionKey = "channels" | "dms" | "projects" | "documents" | "diagrams" | "spreadsheets" | "recents";

function readCookie(): Record<SectionKey, boolean> {
  const defaults: Record<SectionKey, boolean> = {
    channels: true,
    dms: true,
    projects: false,
    documents: false,
    diagrams: false,
    spreadsheets: false,
    recents: true,
  };
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${COOKIE_NAME}=`));
    if (match) {
      return { ...defaults, ...JSON.parse(decodeURIComponent(match.split("=")[1])) };
    }
  } catch {
    // ignore malformed cookie
  }
  return defaults;
}

function writeCookie(state: Record<SectionKey, boolean>) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${COOKIE_MAX_AGE}`;
}

export function useSidebarSections() {
  const [sections, setSections] = useState(readCookie);

  const isOpen = (key: SectionKey) => sections[key] ?? true;

  const toggle = (key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeCookie(next);
      return next;
    });
  };

  return { isOpen, toggle };
}
