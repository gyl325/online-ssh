import type { Host } from "./types";

export function getHostDisplayName(host: Host) {
  return host.name || `${host.username}@${host.host}:${host.port}`;
}

export function getHostEndpoint(host: Host) {
  return `${host.username}@${host.host}:${host.port}`;
}

export function hostMatchesSearch(host: Host, keyword: string) {
  const query = keyword.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [
    getHostDisplayName(host),
    getHostEndpoint(host),
    host.host,
    host.username,
    String(host.port),
    host.remark || ""
  ].some((value) => value.toLowerCase().includes(query));
}

export function buildHostLabelMap(hosts: Host[]) {
  return hosts.reduce<Record<string, string>>((labels, host) => {
    labels[host.id] = getHostDisplayName(host);
    return labels;
  }, {});
}

export function sortHostsByRecentActivity(hosts: Host[]) {
  return [...hosts].sort((left, right) => {
    const leftTime = Date.parse(left.last_connected_at || left.updated_at || left.created_at);
    const rightTime = Date.parse(right.last_connected_at || right.updated_at || right.created_at);
    return rightTime - leftTime;
  });
}
