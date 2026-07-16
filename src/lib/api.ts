const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function getApiUrl(path = ""): string {
  if (!API_URL) {
    throw new Error("VITE_API_URL is not set");
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_URL}${normalized}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
