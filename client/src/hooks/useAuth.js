import { useQuery, useQueryClient } from '@tanstack/react-query';
import useStore from '../store/useStore.js';

export function useAuth() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () =>
      fetch('/api/auth/me')
        .then(r => r.json())
        .catch(() => ({ authenticated: false, authMode: 'setup' })),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return {
    isLoading,
    authenticated: data?.authenticated || false,
    user:          data?.user     || null,
    authMode:      data?.authMode || 'setup',
    isAdmin:       data?.user?.isAdmin      || false,
    isSuperAdmin:  data?.user?.isSuperAdmin || false,
    role:          data?.user?.role         || 'all',
    setupMode:     data?.user?.setupMode    || false,
    logout: async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      useStore.getState().setActiveDept(null); // clear stale dept so next user starts fresh
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
  };
}
