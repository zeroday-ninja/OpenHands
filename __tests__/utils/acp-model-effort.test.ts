import { describe, expect, it } from "vitest";
import {
  composeAcpModelEffort,
  splitAcpModelEffort,
} from "#/utils/acp-model-effort";
import { labelForAcpModel, toAcpModelOptions } from "#/constants/acp-providers";

describe("ACP model/effort ids", () => {
  it("splits a combined id into its model and effort", () => {
    expect(splitAcpModelEffort("opus[1m]/max")).toEqual({
      modelId: "opus[1m]",
      effort: "max",
    });
  });

  it("recognizes a level only the agent reported", () => {
    expect(splitAcpModelEffort("m1/turbo", ["turbo"])).toEqual({
      modelId: "m1",
      effort: "turbo",
    });
  });

  it("leaves model ids that merely contain a slash whole", () => {
    expect(splitAcpModelEffort("custom/provider/model")).toEqual({
      modelId: "custom/provider/model",
      effort: null,
    });
    expect(splitAcpModelEffort("")).toEqual({ modelId: null, effort: null });
  });

  it("combines a model with an effort, leaving the agent default unsuffixed", () => {
    expect(composeAcpModelEffort("gpt-6-astra", "ultra")).toBe(
      "gpt-6-astra/ultra",
    );
    expect(composeAcpModelEffort("opus", "default")).toBe("opus");
    expect(composeAcpModelEffort("opus", null)).toBe("opus");
  });
});

describe("ACP model options with efforts", () => {
  it("drops a listed model's combined id that an agent reported as a model", () => {
    const options = toAcpModelOptions([
      { model_id: "opus", name: "Opus 5.5" },
      { model_id: "opus/max", name: "opus/max" },
    ]);

    expect(options.map(({ id }) => id)).toEqual(["opus"]);
    expect(labelForAcpModel("opus/max", options)).toBe("Opus 5.5 · Max");
  });

  it("attaches each model's effort levels", () => {
    expect(
      toAcpModelOptions([{ model_id: "haiku", name: "Haiku" }], { haiku: [] }),
    ).toEqual([{ id: "haiku", label: "Haiku", efforts: [] }]);
  });
});
