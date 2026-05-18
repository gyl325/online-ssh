import { useCallback, useEffect, useRef, useState } from "react";

import { listHosts } from "./api";
import type { Host } from "./types";

type UseHostCatalogOptions = {
  formatLoadError: (error: unknown) => string;
};

function applyLocalCatalogChanges(items: Host[], upsertedHosts: Map<string, Host>, removedHostIds: Set<string>) {
  const visibleItems = items
    .filter((host) => !removedHostIds.has(host.id))
    .map((host) => upsertedHosts.get(host.id) || host);
  const serverHostIds = new Set(items.map((host) => host.id));
  const localOnlyHosts = Array.from(upsertedHosts.values())
    .filter((host) => !serverHostIds.has(host.id) && !removedHostIds.has(host.id))
    .reverse();
  return [...localOnlyHosts, ...visibleItems];
}

export function useHostCatalog({ formatLoadError }: UseHostCatalogOptions) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [hostsErrorMessage, setHostsErrorMessage] = useState<string | null>(null);
  const upsertedHostsRef = useRef<Map<string, Host>>(new Map());
  const removedHostIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    const loadHosts = async () => {
      setHostsLoading(true);
      setHostsErrorMessage(null);

      try {
        const response = await listHosts();
        if (mounted) {
          setHosts(applyLocalCatalogChanges(response.items, upsertedHostsRef.current, removedHostIdsRef.current));
        }
      } catch (error) {
        if (mounted) {
          setHostsErrorMessage(formatLoadError(error));
          setHosts([]);
        }
      } finally {
        if (mounted) {
          setHostsLoading(false);
        }
      }
    };

    void loadHosts();

    return () => {
      mounted = false;
    };
  }, [formatLoadError]);

  const upsertHostInCatalog = useCallback((host: Host) => {
    upsertedHostsRef.current.set(host.id, host);
    removedHostIdsRef.current.delete(host.id);
    setHosts((current) => {
      if (current.some((item) => item.id === host.id)) {
        return current.map((item) => (item.id === host.id ? host : item));
      }
      return [host, ...current];
    });
    setHostsErrorMessage(null);
    setHostsLoading(false);
  }, []);

  const removeHostFromCatalog = useCallback((hostId: string) => {
    upsertedHostsRef.current.delete(hostId);
    removedHostIdsRef.current.add(hostId);
    setHosts((current) => current.filter((host) => host.id !== hostId));
  }, []);

  return {
    hosts,
    hostsErrorMessage,
    hostsLoading,
    removeHostFromCatalog,
    upsertHostInCatalog
  };
}
