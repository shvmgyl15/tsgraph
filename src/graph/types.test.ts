import { describe, it, expect } from "vitest";
import { GRAPH_VERSION } from "./types.js";

describe("graph types", () => {
  it("exports GRAPH_VERSION", () => {
    expect(GRAPH_VERSION).toBe("1");
  });
});
