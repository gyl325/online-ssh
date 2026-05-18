export type SavedCommand = {
  id: string;
  user_id: string;
  name: string;
  command_text: string;
  category?: string | null;
  description?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SavedCommandListResponse = {
  items: SavedCommand[];
};

export type SavedCommandResponse = {
  command: SavedCommand;
};

export type SaveCommandInput = {
  name: string;
  command_text: string;
  category?: string | null;
  description?: string | null;
  sort_order?: number;
};
