import { useEffect, useState } from 'react';

export function useDataAge(updatedAt) {
  const [age, setAge] = useState('');

  useEffect(() => {
    if (!updatedAt) {
      setAge('');
      return undefined;
    }

    const calc = () => {
      const mins = Math.floor((Date.now() - updatedAt) / 60000);
      if (mins < 1) setAge('just now');
      else if (mins === 1) setAge('1 min ago');
      else if (mins < 60) setAge(`${mins} mins ago`);
      else {
        const hrs = Math.floor(mins / 60);
        setAge(`${hrs}h ${mins % 60}m ago`);
      }
    };

    calc();
    const timer = setInterval(calc, 30000);
    return () => clearInterval(timer);
  }, [updatedAt]);

  return age;
}

export function DataAge({ updatedAt, staleMinutes = 45 }) {
  const age = useDataAge(updatedAt);

  if (!age || !updatedAt) return null;

  const stale = (Date.now() - updatedAt) > staleMinutes * 60000;

  return (
    <span style={{
      fontSize: 10,
      color: stale ? 'var(--warning)' : 'var(--muted)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      marginLeft: 6,
    }}>
      {stale && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      )}
      Updated {age}
    </span>
  );
}
