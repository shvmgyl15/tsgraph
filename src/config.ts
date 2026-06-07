export function loadEventConfig(): Record<string, any>[] {
  const raw = process.env.CODEGRAPH_EVENT_CONFIG;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("CODEGRAPH_EVENT_CONFIG present but invalid:", e);
    return [];
  }
}
