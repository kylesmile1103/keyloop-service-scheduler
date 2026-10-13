import { describe, expect, it } from "vitest";
import { currentImage, maskedSchedule } from "../scripts/github-verification.mjs";

const image = "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:0123456789ab";
const running = (reference = image) => ({ image: reference, status: { state: "running" } });
const schedule = () => ({ bays: [{ appointments: [{ customerName: "AS", vin: "***********123456", registration: "*******" }] }] });

describe("GitHub deployment smoke assertions", () => {
  it("accepts the actual running image, including a registry digest suffix", () => {
    expect(currentImage([running()], image)).toBe(true);
    expect(currentImage([running(`${image}@sha256:${"a".repeat(64)}`)], image)).toBe(true);
  });
  it("waits for a non-empty, entirely current running placement", () => {
    for (const instances of [[], [running(image.replace(":0123456789ab", ":previous"))],
      [running(), running("old-image")], [{ image, status: { state: "provisioning" } }], [running(`${image}@undefined`)]]) {
      expect(currentImage(instances, image)).toBe(false);
    }
    expect(() => currentImage({ result: [] }, image)).toThrow("JSON array");
  });
  it("requires appointments before proving anonymous masking", () => {
    expect(maskedSchedule({ bays: [{ appointments: [] }] })).toBe(false);
    expect(maskedSchedule(schedule())).toBe(true);
    expect(() => maskedSchedule({})).toThrow();
  });
  it.each([
    { customerName: "Alice Smith" }, { vin: "WVWZZZ1KZAW123456" }, { registration: "AB12CDE" },
    { customerEmail: "fixture@example.test" }, { customerPhone: "fixture-phone" },
  ])("refuses each unmasked or contact field: %j", change => {
    const response = schedule();
    Object.assign(response.bays[0]!.appointments[0]!, change);
    expect(() => maskedSchedule(response)).toThrow();
  });
});
