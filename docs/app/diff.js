// 3方向マージ（ADR-0014）。モックから移植
// 行単位の最長共通部分列。a[i] と対応する b の添字を返す（無ければ -1）
export function lcsMatch(a, b) {
  const n = a.length, m = b.length, w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const match = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { match[i] = j; i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++;
  }
  return match;
}
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
// base を基準に mine と theirs を突き合わせ、塊に分ける
export function diff3(base, mine, theirs) {
  const mb = lcsMatch(base, mine), tb = lcsMatch(base, theirs), out = [];
  let i = 0, j = 0, k = 0;
  while (i < base.length || j < mine.length || k < theirs.length) {
    let a = i;
    while (a < base.length && !(mb[a] >= j && tb[a] >= k)) a++;
    const je = a < base.length ? mb[a] : mine.length, ke = a < base.length ? tb[a] : theirs.length;
    if (a === i && je === j && ke === k) { out.push({ t: "same", lines: [base[i]] }); i++; j++; k++; continue; }
    const B = base.slice(i, a), M = mine.slice(j, je), Th = theirs.slice(k, ke);
    if (same(M, B)) out.push({ t: "theirs", base: B, lines: Th });
    else if (same(Th, B)) out.push({ t: "mine", base: B, lines: M });
    else if (same(M, Th)) out.push({ t: "both", base: B, lines: M });
    else out.push({ t: "conflict", base: B, mine: M, theirs: Th, pick: "both" });
    i = a; j = je; k = ke;
  }
  return out;
}
