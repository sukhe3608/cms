'use strict';

// Server-Sent Events hub. Only PUBLIC events pass through here (built from live
// copies in store.js), so drafts can never reach visitors.
function createHub(store, { maxClients = 2000, keepAliveMs = 25000 } = {}) {
  const clients = new Set();

  // payload is JSON.stringify output, which never contains raw newlines, so one `data:` line is safe.
  const frame = (e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${e.payload}\n\n`;

  function attach(req, res, extraHeaders, lastEventId) {
    if (clients.size >= maxClients) {
      res.writeHead(503, { 'Retry-After': '30', ...extraHeaders });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...extraHeaders,
    });
    res.write('retry: 5000\n\n');

    if (lastEventId !== null) {
      const current = store.currentSeq();
      const oldest = store.oldestSeq();
      // The client is ahead of us (database reset) or behind our retained history: tell it to reload.
      if (lastEventId > current || (oldest > 0 && lastEventId < oldest - 1)) {
        res.write('event: resync\ndata: {}\n\n');
      } else {
        for (const e of store.eventsSince(lastEventId)) res.write(frame(e));
      }
    }

    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  function broadcast(event) {
    if (!event) return;
    const data = frame(event);
    for (const res of clients) {
      try { res.write(data); } catch { clients.delete(res); }
    }
  }

  const timer = setInterval(() => {
    for (const res of clients) {
      try { res.write(':ka\n\n'); } catch { clients.delete(res); }
    }
  }, keepAliveMs);
  timer.unref();

  return {
    attach,
    broadcast,
    size: () => clients.size,
    close() {
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

module.exports = { createHub };
