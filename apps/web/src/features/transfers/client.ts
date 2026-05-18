import { getTransferTask } from "./api";
import type { TransferTask } from "./types";
import { isTransferTerminalStatus } from "./types";

export async function waitForTransferTask(
  taskId: string,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    timeoutMessage?: string;
    isDone?: (task: TransferTask) => boolean;
    onProgress?: (task: TransferTask) => void;
  }
) {
  const intervalMs = options?.intervalMs ?? 1500;
  const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    const response = await getTransferTask(taskId);
    const task = response.task;
    options?.onProgress?.(task);

    if (options?.isDone?.(task) || isTransferTerminalStatus(task.status)) {
      return task;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(options?.timeoutMessage || "Transfer task polling timed out.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}
