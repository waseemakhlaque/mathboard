// YjsRoom — Durable Object: one Y.Doc per room (y-websocket protocol compatible).
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export class YjsRoom {
  constructor(_state, _env) {
    /** @type {Map<WebSocket, Set<number>>} */
    this.conns = new Map();
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on('update', (update) => this.broadcastSync(update));
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc), origin);
    });
  }

  broadcastSync(update, origin = null) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.broadcast(encoding.toUint8Array(enc), origin);
  }

  broadcast(msg, except = null) {
    for (const ws of this.conns.keys()) {
      if (ws === except) continue;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      } catch (_) { this.closeConn(ws); }
    }
  }

  send(ws, msg) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    } catch (_) { this.closeConn(ws); }
  }

  closeConn(ws) {
    const ids = this.conns.get(ws);
    if (ids) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), null);
      this.conns.delete(ws);
    }
    try { ws.close(); } catch (_) {}
  }

  onMessage(ws, data) {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const typ = decoding.readVarUint(dec);
      if (typ === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, enc, this.doc, ws);
        if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
      } else if (typ === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws);
      }
    } catch (e) {
      console.error('YjsRoom message error', e);
      this.closeConn(ws);
    }
  }

  greet(ws) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(ws, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size) {
      const enc2 = encoding.createEncoder();
      encoding.writeVarUint(enc2, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc2, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())));
      this.send(ws, encoding.toUint8Array(enc2));
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('MathBoard Yjs collab — connect via WebSocket', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.acceptWs(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  acceptWs(ws) {
    ws.accept();
    this.conns.set(ws, new Set());
    this.greet(ws);
    ws.addEventListener('message', (ev) => this.onMessage(ws, ev.data));
    ws.addEventListener('close', () => this.closeConn(ws));
    ws.addEventListener('error', () => this.closeConn(ws));
  }
}
