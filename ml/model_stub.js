// Minimal ML-style detector stub; pluggable for future TF.js/WASM models
import { heuristicScore, nodeFeatures } from './heuristics.js';

export class AdDetectorModel {
  constructor() {
    this.threshold = 6; // align with heuristics
    this.enabled = true;
  }
  setThreshold(t) { this.threshold = Math.max(1, Number(t) || this.threshold); }
  enable(v) { this.enabled = !!v; }
  predictFromFeatures(feat) {
    if (!this.enabled) return 0;
    // In future: run real model here
    return heuristicScore(feat);
  }
  predict(el) {
    const feat = nodeFeatures(el);
    return this.predictFromFeatures(feat);
  }
  shouldBlock(el) {
    return this.predict(el) >= this.threshold;
  }
}
