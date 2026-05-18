import { describe, expect, it } from "vitest";

import { HttpError } from "../../shared/api/http";
import { createTranslator } from "../preferences/i18n/translator";
import {
  getConnectionErrorMessage,
  localizeConnectionErrorMessage
} from "./connectionErrorMessages";

describe("connectionErrorMessages", () => {
  it("localizes backend SSH probe classifications", () => {
    const zh = createTranslator("zh-CN");
    const en = createTranslator("en-US");

    expect(localizeConnectionErrorMessage("SSH authentication failed", zh)).toBe("SSH 认证失败，请检查用户名、密码或密钥。");
    expect(localizeConnectionErrorMessage("TCP connection refused", zh)).toBe("目标主机拒绝连接，请检查 SSH 服务是否运行，以及端口是否正确。");
    expect(localizeConnectionErrorMessage("SSH connection timed out", zh)).toBe("SSH 连接超时，请检查网络、主机地址或防火墙策略。");
    expect(localizeConnectionErrorMessage("host is unreachable", zh)).toBe("无法访问目标主机，请检查主机地址、DNS 或网络连通性。");
    expect(localizeConnectionErrorMessage("SSH authentication failed", en)).toBe("SSH authentication failed. Check the username, password, or key.");
  });

  it("normalizes connection messages from thrown api errors", () => {
    const zh = createTranslator("zh-CN");

    expect(
      getConnectionErrorMessage(
        new HttpError(502, {
          code: "TERMINAL_BOOTSTRAP_CONNECT_FAILED",
          message: "TCP connection refused"
        }),
        "连接失败。",
        zh
      )
    ).toBe("目标主机拒绝连接，请检查 SSH 服务是否运行，以及端口是否正确。");
  });

  it("keeps existing api error localization for non-ssh http errors", () => {
    const en = createTranslator("en-US");

    expect(
      getConnectionErrorMessage(
        new HttpError(403, {
          code: "FORBIDDEN",
          message: "permission required"
        }),
        "Connection failed.",
        en
      )
    ).toBe("You do not have permission to perform this action.");
  });
});
