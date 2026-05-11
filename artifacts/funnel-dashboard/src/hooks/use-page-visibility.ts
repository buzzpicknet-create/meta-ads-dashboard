import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface VisibilityRow {
  page_path: string;
  role: string;
  visible: boolean;
}

export interface VisibilityMap {
  [pagePath: string]: {
    [role: string]: boolean;
  };
}

function rowsToMap(rows: VisibilityRow[]): VisibilityMap {
  const map: VisibilityMap = {};
  for (const row of rows) {
    if (!map[row.page_path]) map[row.page_path] = {};
    map[row.page_path]![row.role] = row.visible;
  }
  return map;
}

/** Used in NavBar — fetches visibility for the current user's role only */
export function useMyPageVisibility(): Record<string, boolean> | null {
  const { data } = useQuery({
    queryKey: ["page-visibility-mine"],
    queryFn: () =>
      fetch(`${API}/page-visibility`, { credentials: "include", cache: "no-store" })
        .then((r) => r.json())
        .then((d) => (d.visibility ?? null) as Record<string, boolean> | null),
    staleTime: 0,
  });
  return data ?? null;
}

/** Used in AdminPage — fetches all roles' settings */
export function usePageVisibility() {
  return useQuery({
    queryKey: ["page-visibility"],
    queryFn: () =>
      fetch(`${API}/admin/page-visibility`, { credentials: "include", cache: "no-store" })
        .then((r) => r.json())
        .then((d) => rowsToMap((d.settings ?? []) as VisibilityRow[])),
    staleTime: 0,
  });
}

export function useUpdatePageVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      page_path,
      role,
      visible,
    }: {
      page_path: string;
      role: string;
      visible: boolean;
    }) => {
      const r = await fetch(`${API}/admin/page-visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ page_path, role, visible }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "فشل التحديث");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["page-visibility"] });
      qc.invalidateQueries({ queryKey: ["page-visibility-mine"] });
    },
  });
}
