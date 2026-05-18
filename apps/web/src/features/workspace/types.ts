export type FilesWorkspaceSnapshot = {
  selected_host_id: string;
  open_host_ids: string[];
  active_host_id: string | null;
  current_path: string;
  search_keyword: string;
};

export type TerminalWorkspaceSessionSnapshot = {
  session_id: string;
  host_id: string;
  host_label: string;
  rows: number;
  cols: number;
  started_at: string;
  keep_alive_until?: string | null;
};

export type TerminalWorkspaceSnapshot = {
  open_host_ids: string[];
  active_host_id: string | null;
  sessions: TerminalWorkspaceSessionSnapshot[];
  active_session_id: string | null;
};
