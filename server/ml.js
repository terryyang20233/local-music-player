/** Small local ML primitives: hashing, kNN, SGD logistic regression, skip-gram Item2Vec. */

export function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashInto(vec, start, dim, key, salt = "") {
  const h = fnv1a(`${salt}|${key}`);
  const idx = start + (h % dim);
  vec[idx] += h & 1 ? 1 : -1;
}

export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

export function norm(a) {
  return Math.sqrt(dot(a, a)) || 1;
}

export function cosine(a, b) {
  return dot(a, b) / (norm(a) * norm(b));
}

export function addInPlace(target, src, scale = 1) {
  for (let i = 0; i < target.length; i += 1) target[i] += (src[i] || 0) * scale;
}

export function scaleInPlace(target, scale) {
  for (let i = 0; i < target.length; i += 1) target[i] *= scale;
}

export function zeros(n) {
  return new Float64Array(n);
}

export function sigmoid(z) {
  const x = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-x));
}

export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class LogisticRegression {
  constructor(dim, { lr = 0.08, l2 = 0.002 } = {}) {
    this.dim = dim;
    this.lr = lr;
    this.l2 = l2;
    this.w = zeros(dim);
    this.b = 0;
  }

  score(x) {
    return this.b + dot(this.w, x);
  }

  predict(x) {
    return sigmoid(this.score(x));
  }

  fit(samples, epochs = 60) {
    if (samples.length === 0) return { loss: 0, epochs: 0 };
    let loss = 0;
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      shuffleInPlace(samples);
      loss = 0;
      for (const { x, y } of samples) {
        const p = this.predict(x);
        const err = p - y;
        loss += -(y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9));
        this.b -= this.lr * err;
        for (let j = 0; j < this.dim; j += 1) {
          this.w[j] -= this.lr * (err * (x[j] || 0) + this.l2 * this.w[j]);
        }
      }
      loss /= samples.length;
    }
    return { loss, epochs };
  }

  toJSON() {
    return { dim: this.dim, lr: this.lr, l2: this.l2, w: Array.from(this.w), b: this.b };
  }

  static fromJSON(raw) {
    const model = new LogisticRegression(raw.dim, { lr: raw.lr, l2: raw.l2 });
    model.w = Float64Array.from(raw.w || []);
    model.b = raw.b || 0;
    return model;
  }
}

export class Item2Vec {
  constructor(dim = 16, { lr = 0.05 } = {}) {
    this.dim = dim;
    this.lr = lr;
    this.vectors = new Map();
  }

  vector(id) {
    let v = this.vectors.get(id);
    if (!v) {
      v = zeros(this.dim);
      for (let i = 0; i < this.dim; i += 1) v[i] = (Math.random() - 0.5) / this.dim;
      this.vectors.set(id, v);
    }
    return v;
  }

  trainSessions(sessions, { window = 2, epochs = 12, negatives = 4 } = {}) {
    const vocab = [...new Set(sessions.flat())];
    if (vocab.length < 2) return;
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      for (const seq of sessions) {
        for (let i = 0; i < seq.length; i += 1) {
          const center = this.vector(seq[i]);
          const left = Math.max(0, i - window);
          const right = Math.min(seq.length - 1, i + window);
          for (let j = left; j <= right; j += 1) {
            if (j === i) continue;
            this.#step(center, this.vector(seq[j]), 1);
            for (let n = 0; n < negatives; n += 1) {
              const negId = vocab[Math.floor(Math.random() * vocab.length)];
              if (negId === seq[j] || negId === seq[i]) continue;
              this.#step(center, this.vector(negId), 0);
            }
          }
        }
      }
    }
  }

  #step(center, context, label) {
    const p = sigmoid(dot(center, context));
    const g = (p - label) * this.lr;
    for (let i = 0; i < this.dim; i += 1) {
      const c = center[i];
      const k = context[i];
      center[i] -= g * k;
      context[i] -= g * c;
    }
  }

  toJSON() {
    return {
      dim: this.dim,
      lr: this.lr,
      vectors: Object.fromEntries([...this.vectors.entries()].map(([id, v]) => [id, Array.from(v)])),
    };
  }

  static fromJSON(raw) {
    const model = new Item2Vec(raw.dim || 16, { lr: raw.lr });
    for (const [id, v] of Object.entries(raw.vectors || {})) {
      model.vectors.set(id, Float64Array.from(v));
    }
    return model;
  }
}
