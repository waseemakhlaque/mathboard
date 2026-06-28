// MathBoard collab entry — route WebSocket upgrades to a YjsRoom DO per room name.
import { YjsRoom } from './YjsRoom.js';

export { YjsRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // y-websocket uses pathname as doc name: /room-name
    const room = decodeURIComponent(url.pathname.replace(/^\//, '') || 'default');
    const id = env.YJS_ROOM.idFromName(room);
    const stub = env.YJS_ROOM.get(id);
    return stub.fetch(request);
  },
};
