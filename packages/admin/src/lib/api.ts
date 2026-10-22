export type Identity = {
  id: string;
  email: string;
  displayName: string;
  permissions: string[];
};

export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;
export type ApiOptions = {
  baseUrl?: string;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
};

export function createApiClient(config: ApiOptions = {}): ApiClient {
  return async <T>(path: string, options?: RequestInit): Promise<T> => {
    const headers = new Headers(config.headers);
    headers.set('X-CMS-Request', '1');
    if (!(options?.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    new Headers(options?.headers).forEach((value, key) =>
      headers.set(key, value),
    );
    const response = await (config.fetch ?? fetch)(
      `${(config.baseUrl ?? '/api').replace(/\/$/, '')}${path}`,
      {
        credentials: config.credentials ?? 'same-origin',
        cache: 'no-store',
        ...options,
        headers,
      },
    );
    if (!response.ok) {
      if (response.status === 401) config.onUnauthorized?.();
      const body = await response.json().catch(() => null);
      throw new Error(
        Array.isArray(body?.message)
          ? body.message.join(', ')
          : body?.message || `Request failed (${response.status}).`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };
}

export type AuthAdapter = {
  getIdentity: () => Promise<Identity>;
  login: (credentials: {
    email: string;
    password: string;
  }) => Promise<Identity>;
  logout: () => Promise<unknown>;
};

export function createSessionAuth(api: ApiClient): AuthAdapter {
  return {
    getIdentity: () => api<Identity>('/auth/me'),
    login: (credentials) =>
      api<Identity>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
    logout: () => api('/auth/logout', { method: 'POST' }),
  };
}
