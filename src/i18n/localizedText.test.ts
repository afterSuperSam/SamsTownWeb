import { describe, expect, it } from "vitest";
import { localizedText } from "./localizedText";

describe("localizedText", () => {
  it("uses Chinese copy when optional English copy is empty", () => {
    expect(localizedText("楹雾成立", "", "en")).toBe("楹雾成立");
    expect(localizedText("楹雾成立", "Yingwu was founded", "en")).toBe("Yingwu was founded");
  });
});
