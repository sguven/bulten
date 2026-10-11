// Testlerde claude.use('db') yerine geçen sahte veri deposu.
// Gerçek API'nin kullanılan kısmını taklit eder: collection().where().orderBy().limit().get()/onSnapshot()
(function () {
  const docs = new Map(Object.entries(window.__SEED_DOCS || {}));
  const listeners = new Set();
  const cfg = window.__FAKE_DB || {};

  const snapDoc = (id) => ({ id, exists: true, data: () => docs.get(id), metadata: { fromCache: false, hasPendingWrites: false } });

  function run(q) {
    let ids = [...docs.keys()];
    for (const [f, op, v] of q.filters) {
      ids = ids.filter((id) => {
        const x = (docs.get(id) || {})[f];
        if (op === '<') return x < v;
        if (op === '>') return x > v;
        if (op === '==') return x === v;
        throw new Error('fake-db: desteklenmeyen operatör ' + op);
      });
    }
    if (q.order) {
      const [f, dir] = q.order;
      ids.sort((a, b) => {
        const x = (docs.get(a) || {})[f]; const y = (docs.get(b) || {})[f];
        if (x === undefined) return 1; if (y === undefined) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    } else ids.sort();
    if (q.lim) ids = ids.slice(0, q.lim);
    const list = ids.map(snapDoc);
    return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }

  function query(q) {
    return {
      where: (f, op, v) => query({ ...q, filters: [...q.filters, [f, op, v]] }),
      orderBy: (f, dir = 'asc') => query({ ...q, order: [f, dir] }),
      limit: (n) => query({ ...q, lim: n }),
      get: async () => { if (cfg.failGet) throw { code: 'unavailable', message: 'x' }; return run(q); },
      onSnapshot: (next, error) => {
        if (cfg.failSnapshot) { setTimeout(() => error && error({ code: 'unavailable', message: 'test' }), 10); return () => {}; }
        const l = () => next(run(q));
        listeners.add(l);
        setTimeout(l, cfg.delay || 5);
        return () => listeners.delete(l);
      },
    };
  }

  const db = {
    collection: (name) => ({ ...query({ name, filters: [], order: null, lim: 0 }), doc: (id) => ({ id }) }),
    doc: (path) => ({ path }),
  };

  window.__fakeDb = {
    put(id, data) { docs.set(id, data); listeners.forEach((l) => l()); },
    remove(id) { docs.delete(id); listeners.forEach((l) => l()); },
    count: () => docs.size,
  };
  window.claude = { use: async (name) => (name === 'db' && !cfg.noDb ? db : null) };
})();
