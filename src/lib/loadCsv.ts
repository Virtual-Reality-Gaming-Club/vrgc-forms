export const loadCsv = async (path: string): Promise<Set<string>> => {
  try {
    const res = await fetch(path);
    if (!res.ok) return new Set();
    const txt = await res.text();
    const lines = txt
      .split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(l => l.length > 0 && !l.startsWith('email'));
    return new Set(lines);
  } catch (err) {
    console.error(`Failed to load CSV at ${path}:`, err);
    return new Set();
  }
};
