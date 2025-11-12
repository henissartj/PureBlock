// Simple LRU cache to memoize selector/host patterns and avoid reprocessing
export class LRU {
  constructor(limit = 256) {
    this.limit = limit;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

export class AdCache {
  constructor() {
    this.nodeSeen = new WeakSet();
    this.selectorLRU = new LRU(512);
  }
  seenNode(node) {
    if (this.nodeSeen.has(node)) return true;
    this.nodeSeen.add(node);
    return false;
  }
  getSelector(key) { return this.selectorLRU.get(key); }
  setSelector(key, val) { this.selectorLRU.set(key, val); }
}
