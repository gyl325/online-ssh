export type HostAuthType = "password" | "private_key";

export type Host = {
  id: string;
  group_id?: string | null;
  credential_id?: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: HostAuthType;
  remark?: string | null;
  is_favorite: boolean;
  status: string;
  last_connected_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type HostListResponse = {
  items: Host[];
  page: number;
  page_size: number;
  total: number;
};

export type HostGroup = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type HostGroupListResponse = {
  items: HostGroup[];
};

export type HostGroupResponse = {
  group: HostGroup;
};

export type SaveHostGroupInput = {
  name: string;
  sort_order: number;
};

export type HostResponse = {
  host: Host;
};

export type HostSystemInfo = {
  hostname: string;
  os_name: string;
  kernel: string;
};

export type HostSSHInfo = {
  user: string;
  client: string;
};

export type HostLoginInfo = {
  active_login_count?: number | null;
  last_login: string;
  recent_logins?: string[] | null;
};

export type HostMetrics = {
  host_id: string;
  collected_at: string;
  cpu_usage_percent?: number | null;
  memory_usage_percent?: number | null;
  memory_used_bytes?: number | null;
  memory_total_bytes?: number | null;
  disk_usage_percent?: number | null;
  disk_used_bytes?: number | null;
  disk_total_bytes?: number | null;
  uptime_seconds?: number | null;
  gpu_usage_percent?: number | null;
  system: HostSystemInfo;
  ssh: HostSSHInfo;
  login: HostLoginInfo;
};

export type HostMetricsResponse = {
  metrics: HostMetrics;
};

export type HostFingerprint = {
  algorithm: string;
  fingerprint: string;
  status: string;
  first_seen_at?: string | null;
  last_verified_at?: string | null;
};

export type TestHostResponse = {
  ok: boolean;
  message: string;
  fingerprint: HostFingerprint;
};

export type HostFingerprintConflictResponse = {
  code: string;
  message: string;
  current_fingerprint: HostFingerprint;
  previous_fingerprint?: HostFingerprint | null;
};

export type CreateHostInput = {
  group_id?: string | null;
  credential_id?: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: HostAuthType;
  is_favorite: boolean;
};

export type UpdateHostInput = Partial<CreateHostInput>;

export type TestHostInput = {
  host?: string;
  port?: number;
  username?: string;
  auth_type?: HostAuthType;
  credential_id?: string | null;
  password?: string;
  private_key?: string;
  passphrase?: string;
};
