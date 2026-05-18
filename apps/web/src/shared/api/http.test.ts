import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authUnauthorizedEvent, request, requestBlob, setAuthRefreshHandler } from "./http";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("api request auth refresh", () => {
  afterEach(() => {
    setAuthRefreshHandler(null);
    vi.unstubAllGlobals();
  });

  it("refreshes once and retries the failed request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: "UNAUTHORIZED", message: "login required" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshHandler = vi.fn().mockResolvedValue(undefined);
    const unauthorizedHandler = vi.fn();
    window.addEventListener(authUnauthorizedEvent, unauthorizedHandler);
    setAuthRefreshHandler(refreshHandler);

    const result = await request<{ ok: boolean }>({ path: "/api/protected" });

    expect(result.ok).toBe(true);
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorizedHandler).not.toHaveBeenCalled();
    window.removeEventListener(authUnauthorizedEvent, unauthorizedHandler);
  });

  it("treats empty successful responses as undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request<void>({ method: "DELETE", path: "/api/resource" });

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resource",
      expect.objectContaining({
        method: "DELETE"
      })
    );
  });

  it("requests blob responses through a dedicated helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["download"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await requestBlob({ path: "/api/downloads/file" });

    expect(await blob.text()).toBe("download");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/downloads/file",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("shares one refresh call across concurrent unauthorized requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: "UNAUTHORIZED", message: "login required" }))
      .mockResolvedValueOnce(jsonResponse(401, { code: "UNAUTHORIZED", message: "login required" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = createDeferred<void>();
    const refreshHandler = vi.fn().mockReturnValue(refresh.promise);
    setAuthRefreshHandler(refreshHandler);

    const firstPromise = request<{ id: number }>({ path: "/api/first" });
    const secondPromise = request<{ id: number }>({ path: "/api/second" });
    await waitFor(() => expect(refreshHandler).toHaveBeenCalledTimes(1));
    refresh.resolve();

    const [first, second] = await Promise.all([
      firstPromise,
      secondPromise
    ]);

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not refresh revoked sessions and dispatches the invalidation reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { code: "AUTH_SESSION_REVOKED", message: "session revoked" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const refreshHandler = vi.fn().mockResolvedValue(undefined);
    const unauthorizedHandler = vi.fn();
    window.addEventListener(authUnauthorizedEvent, unauthorizedHandler);
    setAuthRefreshHandler(refreshHandler);

    await expect(request<{ ok: boolean }>({ path: "/api/protected" })).rejects.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
      status: 401
    });

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(unauthorizedHandler).toHaveBeenCalledTimes(1);
    expect(unauthorizedHandler.mock.calls[0][0]).toMatchObject({
      detail: {
        reason: "session_revoked"
      }
    });
    window.removeEventListener(authUnauthorizedEvent, unauthorizedHandler);
  });

  it("lets callers handle skipped auth refresh failures without global invalidation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { code: "AUTH_SESSION_REVOKED", message: "session revoked" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const refreshHandler = vi.fn().mockResolvedValue(undefined);
    const unauthorizedHandler = vi.fn();
    window.addEventListener(authUnauthorizedEvent, unauthorizedHandler);
    setAuthRefreshHandler(refreshHandler);

    await expect(request<{ ok: boolean }>({ path: "/api/auth/me", skipAuthRefresh: true })).rejects.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
      status: 401
    });

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(unauthorizedHandler).not.toHaveBeenCalled();
    window.removeEventListener(authUnauthorizedEvent, unauthorizedHandler);
  });

  it("does not treat credential validation failures as expired sessions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: "INVALID_CURRENT_PASSWORD", message: "current password is incorrect" }))
      .mockResolvedValueOnce(jsonResponse(401, { code: "INVALID_CURRENT_PASSWORD", message: "current password is incorrect" }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshHandler = vi.fn().mockResolvedValue(undefined);
    const unauthorizedHandler = vi.fn();
    window.addEventListener(authUnauthorizedEvent, unauthorizedHandler);
    setAuthRefreshHandler(refreshHandler);

    await expect(request<{ ok: boolean }>({ method: "POST", path: "/api/auth/2fa/setup", body: { password: "wrong" } })).rejects.toMatchObject({
      code: "INVALID_CURRENT_PASSWORD",
      status: 401
    });

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(unauthorizedHandler).not.toHaveBeenCalled();
    window.removeEventListener(authUnauthorizedEvent, unauthorizedHandler);
  });
});
