import { request } from "../../shared/api/http";
import type { SavedCommandListResponse, SavedCommandResponse, SaveCommandInput } from "./types";

export function listSavedCommands() {
  return request<SavedCommandListResponse>({
    path: "/api/saved-commands"
  });
}

export function createSavedCommand(input: SaveCommandInput) {
  return request<SavedCommandResponse>({
    method: "POST",
    path: "/api/saved-commands",
    body: input
  });
}

export function updateSavedCommand(commandId: string, input: SaveCommandInput) {
  return request<SavedCommandResponse>({
    method: "PUT",
    path: `/api/saved-commands/${commandId}`,
    body: input
  });
}

export function deleteSavedCommand(commandId: string) {
  return request<void>({
    method: "DELETE",
    path: `/api/saved-commands/${commandId}`,
    responseType: "void"
  });
}
