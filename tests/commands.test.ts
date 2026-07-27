import { describe, expect, it } from "vitest";
import { parseConjugateCommand } from "../src/capabilities/conjugate.js";
import { parseExplainCommand } from "../src/capabilities/explain.js";
import { parseStatsCommand } from "../src/capabilities/stats.js";

describe("command parsers", () => {
  it("parses explanation offsets and keyword focus", () => {
    expect(parseExplainCommand("!!!")).toEqual({
      offset: -1,
      keywords: null,
    });
    expect(parseExplainCommand("!!! -2")).toEqual({
      offset: -2,
      keywords: null,
    });
    expect(parseExplainCommand("!!! che boludo")).toEqual({
      offset: -1,
      keywords: "che boludo",
    });
    expect(parseExplainCommand("hello !!!")).toBeNull();
  });

  it("parses conjugation input", () => {
    expect(parseConjugateCommand("!conj tener present")).toEqual({
      verb: "tener",
      qualifier: "present",
    });
    expect(parseConjugateCommand("!conj")).toEqual({
      verb: "",
      qualifier: null,
    });
  });

  it("keeps statistics periods explicit", () => {
    expect(parseStatsCommand("!stats")).toBe("today");
    expect(parseStatsCommand("!stats week")).toBe("week");
    expect(parseStatsCommand("!stats year")).toBeNull();
  });
});

