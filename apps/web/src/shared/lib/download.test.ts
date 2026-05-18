import { afterEach, describe, expect, it, vi } from "vitest";

import { saveBlobAsFile } from "./download";

describe("download helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a blob through a temporary anchor and revokes the object URL", () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, "appendChild");
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler();
      }
      return 1;
    });
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });

    saveBlobAsFile(blob, "hello.txt");

    const anchor = appendChild.mock.calls[0][0] as HTMLAnchorElement;
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:download-url");
    expect(anchor.download).toBe("hello.txt");
    expect(anchor.style.display).toBe("none");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.body.contains(anchor)).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download-url");
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(createElement).toHaveBeenCalledWith("a");
  });
});
