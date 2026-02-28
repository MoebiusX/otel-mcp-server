import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Kong Gateway URL - defaults to empty string (use nginx proxy) for containerized deployments
const KONG_URL = import.meta.env.VITE_KONG_URL || '';

/**
 * Get authorization headers from stored access token
 */
function getAuthHeaders(): Record<string, string> {
  const accessToken = localStorage.getItem('accessToken');
  if (accessToken) {
    return { 'Authorization': `Bearer ${accessToken}` };
  }
  return {};
}

/**
 * Handle 401 Unauthorized responses by clearing auth state and redirecting to landing page
 */
function handleUnauthorized(): void {
  // Clear all auth state
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');

  // Redirect to landing page if not already there
  if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
    window.location.href = '/';
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Check for 401 and redirect instead of throwing
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Session expired - please login again');
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  customHeaders?: Record<string, string>,
): Promise<Response> {
  const headers = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...getAuthHeaders(),
    ...(customHeaders || {}),
  };

  // All API requests go through Kong Gateway:
  // - If client provides traceparent → Kong preserves and propagates it
  // - If no traceparent → Kong creates new trace context

  let targetUrl = url;
  if (url.startsWith('/api/')) {
    // Only add v1 if not already versioned - prevents /api/v1/ → /api/v1/v1/
    const versionedUrl = url.startsWith('/api/v1/') ? url : url.replace(/^\/api\//, '/api/v1/');
    targetUrl = `${KONG_URL}${versionedUrl}`;
  }

  const res = await fetch(targetUrl, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "same-origin",
    cache: "no-cache",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "redirect";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const url = queryKey[0] as string;

      // Route all /api requests through Kong Gateway with v1 versioning
      let targetUrl = url;
      if (url.startsWith('/api/')) {
        // Only add v1 if not already versioned - prevents /api/v1/ → /api/v1/v1/
        const versionedUrl = url.startsWith('/api/v1/') ? url : url.replace(/^\/api\//, '/api/v1/');
        targetUrl = `${KONG_URL}${versionedUrl}`;
      }

      const res = await fetch(targetUrl, {
        credentials: "same-origin",
        cache: "no-cache",
        headers: getAuthHeaders(),
      });

      // Handle 401 based on specified behavior
      if (res.status === 401) {
        if (unauthorizedBehavior === "redirect") {
          handleUnauthorized();
          return null;
        }
        if (unauthorizedBehavior === "returnNull") {
          return null;
        }
        // "throw" - let throwIfResNotOk handle it (which also redirects now)
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
