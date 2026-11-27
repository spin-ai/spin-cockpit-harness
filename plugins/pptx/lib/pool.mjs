/** 页级并发池：默认 4–6，不引第三方队列。 */
export async function runPool(items, worker, { concurrency = 5, signal, onStart, onSettle } = {}) {
  const size = Math.max(1, Math.min(16, Number(concurrency) || 5));
  const results = new Array(items.length).fill(null);
  let cursor = 0;
  let active = 0;
  let peak = 0;

  return new Promise((resolve) => {
    let settled = 0;
    const finish = () => resolve({ results, peak });
    const launch = () => {
      if (settled >= items.length) return finish();
      while (active < size && cursor < items.length) {
        if (signal?.aborted) {
          // 剩下的页面直接标成取消，不再消耗模型额度
          while (cursor < items.length) {
            const index = cursor;
            results[index] = { ok: false, canceled: true, error: "已取消", item: items[index] };
            settled += 1;
            onSettle?.(items[index], results[index], index);
            cursor += 1;
          }
          if (settled >= items.length) finish();
          return;
        }
        const index = cursor;
        const item = items[index];
        cursor += 1;
        active += 1;
        peak = Math.max(peak, active);
        onStart?.(item, index);
        Promise.resolve()
          .then(() => worker(item, index, signal))
          .then((value) => ({ ok: true, value, item }))
          .catch((error) => ({ ok: false, error: String(error?.message || error), item }))
          .then((result) => {
            active -= 1;
            results[index] = result;
            settled += 1;
            onSettle?.(item, result, index);
            if (settled >= items.length) finish();
            else launch();
          });
      }
    };
    if (!items.length) finish();
    else launch();
  });
}
