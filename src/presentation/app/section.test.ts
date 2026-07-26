import { describe, expect, it } from "vitest";
import { Section } from "./section";

describe("Section", () => {
  it("reconstrói na primeira vez e quando a assinatura muda", () => {
    let runs = 0;
    const section = new Section(() => { runs += 1; });
    section.update("a");
    section.update("b");
    expect(runs).toBe(2);
  });

  it("não reconstrói quando a assinatura repete", () => {
    let runs = 0;
    const section = new Section(() => { runs += 1; });
    section.update("a");
    section.update("a");
    section.update("a");
    expect(runs).toBe(1);
  });
});
