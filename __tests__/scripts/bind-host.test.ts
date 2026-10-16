import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BIND_HOST,
  applySessionKeyPolicy,
  bindHostArgs,
  detectDockerBridgeHost,
  isLoopbackBind,
  resolveBindHost,
} from "../../scripts/bind-host.mjs";

describe("bind-host", () => {
  it("defaults to IPv4 loopback", () => {
    expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
    expect(resolveBindHost({})).toBe("127.0.0.1");
  });

  it("prefers --host over OH_BIND_HOST", () => {
    expect(
      resolveBindHost({ flag: "0.0.0.0", env: "::" }),
    ).toBe("0.0.0.0");
  });

  it("treats :: and 0.0.0.0 as non-loopback", () => {
    expect(isLoopbackBind("::")).toBe(false);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
    expect(isLoopbackBind("[::1]")).toBe(true);
    expect(isLoopbackBind("localhost")).toBe(true);
  });

  it("recognizes the full 127.0.0.0/8 loopback range (RFC 3330)", () => {
    expect(isLoopbackBind("127.0.0.2")).toBe(true);
    expect(isLoopbackBind("127.0.0.3")).toBe(true);
    expect(isLoopbackBind("127.1.2.3")).toBe(true);
    expect(isLoopbackBind("127.255.255.255")).toBe(true);
  });

  it("strips the session key when bound off-loopback", () => {
    const warn = vi.fn();
    const policy = applySessionKeyPolicy({
      host: "::",
      sessionApiKey: "secret-key",
      warn,
    });
    expect(policy.sessionApiKey).toBeNull();
    expect(policy.authRequired).toBe(true);
    expect(policy.strippedSessionKey).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the session key on loopback", () => {
    const policy = applySessionKeyPolicy({
      host: "127.0.0.1",
      sessionApiKey: "secret-key",
      warn: () => {},
    });
    expect(policy.sessionApiKey).toBe("secret-key");
    expect(policy.authRequired).toBe(false);
    expect(policy.strippedSessionKey).toBe(false);
  });

  it("keeps the session key on non-loopback when explicitly allowed", () => {
    const policy = applySessionKeyPolicy({
      host: "::",
      sessionApiKey: "secret-key",
      allowLanSessionKey: true,
      warn: () => {},
    });
    expect(policy.sessionApiKey).toBe("secret-key");
    expect(policy.strippedSessionKey).toBe(false);
  });

  it("emits --host for child processes", () => {
    expect(bindHostArgs("127.0.0.1")).toEqual(["--host", "127.0.0.1"]);
  });
});

describe("detectDockerBridgeHost", () => {
  const dockerReports = (stdout: string) => () => ({ status: 0, stdout });
  const hostAddresses =
    (...addresses: string[]) =>
    () => ({ eth0: addresses.map((address) => ({ address })) });

  it("returns the bridge gateway when this host owns it (native Docker Engine)", () => {
    expect(
      detectDockerBridgeHost({
        run: dockerReports("172.17.0.1 \n"),
        interfaces: hostAddresses("192.168.4.60", "172.17.0.1"),
      }),
    ).toBe("172.17.0.1");
  });

  it("returns null when the gateway lives elsewhere (Docker Desktop VM)", () => {
    expect(
      detectDockerBridgeHost({
        run: dockerReports("172.17.0.1"),
        interfaces: hostAddresses("192.168.4.60"),
      }),
    ).toBeNull();
  });

  it("returns null when the docker CLI fails or is missing", () => {
    const interfaces = hostAddresses("172.17.0.1");
    expect(
      detectDockerBridgeHost({
        run: () => ({ status: 1, stdout: "" }),
        interfaces,
      }),
    ).toBeNull();
    expect(
      detectDockerBridgeHost({
        run: () => ({ status: null, error: new Error("spawn docker ENOENT") }),
        interfaces,
      }),
    ).toBeNull();
  });
});
