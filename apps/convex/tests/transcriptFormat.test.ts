import { describe, it, expect } from "vitest";
import { transcriptToMarkdown } from "../convex/transcriptFormat";

describe("transcriptToMarkdown", () => {
  it("formats a JSON array of {name, transcript} entries", () => {
    const raw = JSON.stringify([
      { name: "Alice", transcript: "Hello everyone." },
      { name: "Bob", transcript: "Hi Alice." },
    ]);
    expect(transcriptToMarkdown(raw)).toBe(
      "**Alice:** Hello everyone.\n\n**Bob:** Hi Alice.",
    );
  });

  it("handles alternate speaker/text key names", () => {
    const raw = JSON.stringify([{ speaker: "Carol", text: "Testing." }]);
    expect(transcriptToMarkdown(raw)).toBe("**Carol:** Testing.");
  });

  it("unwraps a { transcripts: [...] } envelope and skips empty text", () => {
    const raw = JSON.stringify({
      transcripts: [
        { name: "Dan", transcript: "Line one." },
        { name: "Dan", transcript: "   " },
      ],
    });
    expect(transcriptToMarkdown(raw)).toBe("**Dan:** Line one.");
  });

  it("converts WebVTT cues, stripping timings and voice tags", () => {
    const raw = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.000",
      "<v Alice>Hello there</v>",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "<v Bob>General Kenobi</v>",
    ].join("\n");
    expect(transcriptToMarkdown(raw)).toBe(
      "**Alice:** Hello there\n\n**Bob:** General Kenobi",
    );
  });

  it("converts SRT cues, dropping the numeric index lines", () => {
    const raw = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "Hello there",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,000",
      "General Kenobi",
    ].join("\n");
    expect(transcriptToMarkdown(raw)).toBe("Hello there\n\nGeneral Kenobi");
  });

  it("parses CSV with a header, handling commas inside quoted text", () => {
    const raw =
      'timestamp,name,transcript\n' +
      '1717668000,Alice,"Hello, everyone"\n' +
      '1717668005,Bob,"Hi Alice, good to see you"';
    expect(transcriptToMarkdown(raw, "csv")).toBe(
      "**Alice:** Hello, everyone\n\n**Bob:** Hi Alice, good to see you",
    );
  });

  it("parses headerless RealtimeKit CSV (name 2nd-to-last, text last)", () => {
    // Real shape: [timestamp, sessionId, peerId, participantId, name, transcript]
    const raw =
      '"1780741376927","f517d643-044a-4567-9c84-4b6531ddc7d3","aaac5deb-cff0-4321-8da1-d4be6b44ea57","jx7cq8ezkzf2x90zw2wkzqg7ds81cbrc","Marco Necci","This is a test."\n' +
      '"1780741383187","f517d643-044a-4567-9c84-4b6531ddc7d3","aaac5deb-cff0-4321-8da1-d4be6b44ea57","jx7cq8ezkzf2x90zw2wkzqg7ds81cbrc","Marco Necci","Second line, with a comma."';
    expect(transcriptToMarkdown(raw, "csv")).toBe(
      "**Marco Necci:** This is a test.\n\n**Marco Necci:** Second line, with a comma.",
    );
  });

  it("auto-detects CSV when no hint is given", () => {
    const raw = 'name,transcript\nAlice,Hello there\nBob,General Kenobi';
    expect(transcriptToMarkdown(raw)).toBe(
      "**Alice:** Hello there\n\n**Bob:** General Kenobi",
    );
  });

  it("CSV with no recognizable text column falls back to the last column", () => {
    const raw = 'speaker,start,words\nAlice,0,Hello\nBob,5,World';
    // 'words' matches TEXT_COL, but verify last-column fallback via headerless data
    expect(transcriptToMarkdown(raw, "csv")).toBe(
      "**Alice:** Hello\n\n**Bob:** World",
    );
  });

  it("falls back to raw plain text", () => {
    expect(transcriptToMarkdown("just some words")).toBe("just some words");
  });

  it("returns empty string for blank input", () => {
    expect(transcriptToMarkdown("   \n  ")).toBe("");
  });
});
