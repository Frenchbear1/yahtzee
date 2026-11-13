// A small in-memory stand-in for the Firebase compat Firestore API, used by
// tests/online-rooms.test.ts and for previewing multiplayer screens.
export function createFakeFirestore() {
  const docs = new Map<string, Data>();
  let serverSkew = 0;
  const sentinel = { __serverTimestamp: true };

  const resolveValue = (value: unknown): unknown => {
    if (value === sentinel) { const at = Date.now() + serverSkew; return { toMillis: () => at }; }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value && typeof value === 'object' && !('toMillis' in value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v)]));
    return value;
  };
  const copy = <T>(value: T): T => value === undefined ? value : structuredClone(value, {}) as T;
  const safeCopy = (value: Data | undefined) => value && Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v && typeof v === 'object' && 'toMillis' in (v as object) ? v : copy(v)]));

  function applySet(path: string, data: Data, merge?: boolean) {
    const value = resolveValue(data) as Data;
    docs.set(path, merge ? { ...(docs.get(path) || {}), ...value } : value);
  }
  function applyUpdate(path: string, data: Data) {
    const current = docs.get(path);
    if (!current) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
    const next = { ...current };
    for (const [key, raw] of Object.entries(data)) {
      const value = resolveValue(raw);
      if (key.includes('.')) {
        const [head, tail] = key.split('.');
        next[head] = { ...(next[head] as Data || {}), [tail]: value };
      } else next[key] = value;
    }
    docs.set(path, next);
  }

  function docRef(path: string): any {
    const id = path.split('/').pop()!;
    const snap = () => ({ id, exists: docs.has(path), data: () => safeCopy(docs.get(path)) });
    return {
      id, path,
      get: async () => snap(),
      set: async (data: Data, options?: { merge?: boolean }) => applySet(path, data, options?.merge),
      update: async (data: Data) => applyUpdate(path, data),
      delete: async () => { docs.delete(path); },
      collection: (sub: string) => collectionRef(`${path}/${sub}`),
      _snap: snap,
    };
  }
  function collectionRef(path: string, filters: Array<(d: Data) => boolean> = [], order?: [string, string], max?: number): any {
    const depth = path.split('/').length + 1;
    return {
      doc: (id = crypto.randomUUID()) => docRef(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => collectionRef(path, [...filters, d => op === '==' ? d[field] === value : Array.isArray(d[field]) && (d[field] as unknown[]).includes(value)], order, max),
      orderBy: (field: string, direction = 'asc') => collectionRef(path, filters, [field, direction], max),
      limit: (count: number) => collectionRef(path, filters, order, count),
      get: async () => {
        let rows = [...docs.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === depth).filter(([, d]) => filters.every(f => f(d)));
        if (order) rows.sort((a, b) => (Number(a[1][order[0]]) - Number(b[1][order[0]])) * (order[1] === 'desc' ? -1 : 1));
        if (max) rows = rows.slice(0, max);
        return { docs: rows.map(([key]) => docRef(key)._snap()) };
      },
    };
  }
  function writer() {
    const ops: Array<() => void> = [];
    const api: any = {
      set: (ref: any, data: Data, options?: { merge?: boolean }) => { ops.push(() => applySet(ref.path, data, options?.merge)); return api; },
      update: (ref: any, data: Data) => { ops.push(() => applyUpdate(ref.path, data)); return api; },
      delete: (ref: any) => { ops.push(() => docs.delete(ref.path)); return api; },
    };
    const commit = () => { const backup = new Map(docs); try { ops.forEach(op => op()); } catch (e) { docs.clear(); backup.forEach((v, k) => docs.set(k, v)); throw e; } };
    return { api, commit };
  }
  const db = {
    doc: docRef,
    collection: (path: string) => collectionRef(path),
    batch: () => { const w = writer(); return Object.assign(w.api, { commit: async () => w.commit() }); },
    runTransaction: async (callback: (t: any) => Promise<unknown>) => {
      const w = writer();
      const result = await callback(Object.assign(w.api, { get: async (ref: any) => ref.get() }));
      w.commit();
      return result;
    },
  };

  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => sentinel } });
  return { db, docs, firestore, setSkew: (value: number) => { serverSkew = value; } };
}

type Data = Record<string, unknown>;
