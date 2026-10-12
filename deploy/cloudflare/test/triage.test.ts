import { describe, expect, it, vi } from "vitest";
import { containerEnv } from "../src/container-env";
import { edgeSettings } from "../src/settings";
import { fakeEnv } from "./helpers";

const identifiers = {
  KEYLOOP_SECRETS_STORE_ID: "00000000000000000000000000000000",
  KEYLOOP_API_IMAGE: "registry.cloudflare.com/00000000000000000000000000000000/keyloop-scheduler-api:test",
};

describe("optional booking triage", () => {
  it("defaults off and never reads an unused AI secret", async () => {
    const { env } = fakeEnv();
    const token = { get: vi.fn().mockRejectedValue(new Error("must not be read")) };
    const result = await containerEnv(Object.assign(env, { TRIAGE_ENABLED: "false", AI_TOKEN: token }));
    expect(result.Triage__Enabled).toBe("false");
    expect(result).not.toHaveProperty("Triage__ApiToken");
    expect(token.get).not.toHaveBeenCalled();
    expect(edgeSettings(identifiers)).toMatchObject({ triageEnabled: "false", triageAccountId: "", triageGatewayId: "keyloop-scheduler" });
  });

  it("passes the secret only into the container start env when enabled", async () => {
    const { env } = fakeEnv();
    const token = { get: vi.fn().mockResolvedValue("test-token") };
    const result = await containerEnv(Object.assign(env, {
      TRIAGE_ENABLED: "true", TRIAGE_ACCOUNT_ID: "00000000000000000000000000000000", TRIAGE_GATEWAY_ID: "keyloop-scheduler", AI_TOKEN: token,
    }));
    expect(result).toMatchObject({ Triage__Enabled: "true", Triage__AccountId: "00000000000000000000000000000000",
      Triage__GatewayId: "keyloop-scheduler", Triage__ApiToken: "test-token" });
    expect(token.get).toHaveBeenCalledTimes(1);
  });

  it("sanitises missing and failing token reads", async () => {
    const { env } = fakeEnv();
    const token = { get: vi.fn().mockRejectedValue(new Error("private-token-value")) };
    const input = Object.assign(env, { TRIAGE_ENABLED: "true", TRIAGE_ACCOUNT_ID: "00000000000000000000000000000000",
      TRIAGE_GATEWAY_ID: "keyloop-scheduler", AI_TOKEN: token });
    await expect(containerEnv(input)).rejects.toThrow(/^Secrets Store secret keyloop_prod_ai_token is unavailable$/);
    token.get.mockResolvedValue(null);
    await expect(containerEnv(input)).rejects.toThrow(/^Secrets Store secret keyloop_prod_ai_token is unavailable$/);
  });

  it.each([
    [{ KEYLOOP_TRIAGE_ENABLED: "yes" }, "true or false"],
    [{ KEYLOOP_TRIAGE_ENABLED: "true" }, "KEYLOOP_TRIAGE_ACCOUNT_ID"],
    [{ KEYLOOP_TRIAGE_ENABLED: "true", KEYLOOP_TRIAGE_ACCOUNT_ID: "wrong" }, "KEYLOOP_TRIAGE_ACCOUNT_ID"],
    [{ KEYLOOP_TRIAGE_GATEWAY_ID: "unsafe\r\n" }, "gateway slug"],
  ])("rejects invalid settings before container startup", (values, message) => {
    expect(() => edgeSettings({ ...identifiers, ...values })).toThrow(message);
  });
});
