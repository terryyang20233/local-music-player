/** Small local ML primitives: hashing, cosine similarity, SGD logistic regression, skip-gram Item2Vec. */

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

export function zeros(n) {
  return new Float64Array(n);
}

export function sigmoid(z) {
  const x = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-x));
}

/** 可复现的伪随机数（mulberry32）：同样的数据训练出同样的模型。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  /**
   * SGD 训练。samples: [{ x, y, w? }]，y 可以是 0~1 之间的软标签，w 是样本权重（默认 1）。
   */
  fit(samples, epochs = 60, rng = Math.random) {
    if (samples.length === 0) return { loss: 0, epochs: 0 };
    const order = [...samples];
    let loss = 0;
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      shuffleInPlace(order, rng);
      loss = 0;
      let weightSum = 0;
      for (const { x, y, w = 1 } of order) {
        const p = this.predict(x);
        const err = (p - y) * w;
        loss += -w * (y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9));
        weightSum += w;
        this.b -= this.lr * err;
        for (let j = 0; j < this.dim; j += 1) {
          this.w[j] -= this.lr * (err * (x[j] || 0) + this.l2 * this.w[j]);
        }
      }
      loss /= weightSum || 1;
    }
    return { loss, epochs };
  }
}

/** Skip-gram + 负采样。vectors 是用来算相似度的输入向量，contexts 是输出向量。 */
export class Item2Vec {
  constructor(dim = 16, { lr = 0.05, rng = Math.random } = {}) {
    this.dim = dim;
    this.lr = lr;
    this.rng = rng;
    this.vectors = new Map();
    this.contexts = new Map();
  }

  #vec(map, id, random) {
    let v = map.get(id);
    if (!v) {
      v = zeros(this.dim);
      if (random) for (let i = 0; i < this.dim; i += 1) v[i] = (this.rng() - 0.5) / this.dim;
      map.set(id, v);
    }
    return v;
  }

  trainSessions(sessions, { window = 2, epochs = 12, negatives = 4 } = {}) {
    const vocab = [...new Set(sessions.flat())];
    if (vocab.length < 2) return;
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      for (const seq of sessions) {
        for (let i = 0; i < seq.length; i += 1) {
          const center = this.#vec(this.vectors, seq[i], true);
          const left = Math.max(0, i - window);
          const right = Math.min(seq.length - 1, i + window);
          for (let j = left; j <= right; j += 1) {
            if (j === i) continue;
            this.#step(center, this.#vec(this.contexts, seq[j], false), 1);
            for (let n = 0; n < negatives; n += 1) {
              const negId = vocab[Math.floor(this.rng() * vocab.length)];
              if (negId === seq[j] || negId === seq[i]) continue;
              this.#step(center, this.#vec(this.contexts, negId, false), 0);
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
}
