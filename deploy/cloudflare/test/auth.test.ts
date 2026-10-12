import { describe, expect, it } from "vitest";
import { containerEnv } from "../src/container-env";
import { routeRequest } from "../src/router";
import { fakeEnv, edgeRequest } from "./helpers";

const access = {
  AUTH_TEAM_DOMAIN: "https://local-fixture.cloudflareaccess.com",
  AUTH_AUDIENCE: "aud-one,aud-two",
  AUTH_ADMIN: "admin@keyloop.test",
  AUTH_SERVICE_ADVISOR: "advisor@keyloop.test,@workshop.test",
  AUTH_VIEWER: "viewer@keyloop.test",
};

describe("Access identity at the edge", () => {
  it("passes the Access mode, issuer, AUD tags and operator role lists to the API", async () => {
    const settings = await containerEnv({ ...fakeEnv().env, ...access });
    expect(settings).toMatchObject({
      Auth__Mode: "CloudflareAccess", Auth__TeamDomain: access.AUTH_TEAM_DOMAIN,
      Auth__Audience__0: "aud-one", Auth__Audience__1: "aud-two",
      Auth__Roles__Admin__0: "admin@keyloop.test", Auth__Roles__ServiceAdvisor__0: "advisor@keyloop.test",
      Auth__Roles__ServiceAdvisor__1: "@workshop.test", Auth__Roles__Viewer__0: "viewer@keyloop.test",
    });
  });
  it("preserves case in audience tags", async () => {
    const settings = await containerEnv({ ...fakeEnv().env, ...access, AUTH_AUDIENCE: "CaseSensitiveAUD" });
    expect(settings.Auth__Audience__0).toBe("CaseSensitiveAUD");
  });
  it.each(["", "http://local.cloudflareaccess.com", "https://local.cloudflareaccess.com.evil.test", "https://local.cloudflareaccess.com/", "https://local.cloudflareaccess.com:8443"])("rejects an invalid issuer before reading secrets", async domain => {
    const { env, mocks } = fakeEnv();
    await expect(containerEnv({ ...env, ...access, AUTH_TEAM_DOMAIN: domain })).rejects.toThrow("Access team domain");
    expect(mocks.DB_URL.get).not.toHaveBeenCalled();
  });
  it("rejects an empty AUD and invalid role members without echoing them", async () => {
    await expect(containerEnv({ ...fakeEnv().env, ...access, AUTH_AUDIENCE: "" })).rejects.toThrow("Access audience");
    await expect(containerEnv({ ...fakeEnv().env, ...access, AUTH_ADMIN: "personal-data-sentinel" })).rejects.toThrow(/^Configure valid Access role members$/);
  });
  it.each(["/api/v1/me", "/auth/login?returnTo=%2Fboard", "/auth/unknown"])("forwards %s with assertion and cookie unchanged", async path => {
    const { env, mocks } = fakeEnv();
    const request = edgeRequest(path, { headers: { "cf-access-jwt-assertion": "synthetic-token", cookie: "other=value; CF_Authorization=synthetic-cookie" } });
    await routeRequest(request, env);
    const forwarded: Request = mocks.API.get().fetch.mock.calls[0]![0];
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.headers.get("cf-access-jwt-assertion")).toBe("synthetic-token");
    expect(forwarded.headers.get("cookie")).toBe("other=value; CF_Authorization=synthetic-cookie");
    expect(mocks.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
