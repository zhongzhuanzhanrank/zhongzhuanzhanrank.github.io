const PAGE_SIZE = 100;
const state = { sites: [], query: "", vendor: "all", service: "all", sort: "rank", shown: PAGE_SIZE };
const $ = (selector) => document.querySelector(selector);
const elements = {
  body: $("#ranking-body"), summary: $("#result-summary"), search: $("#search-input"),
  vendor: $("#vendor-filter"), service: $("#service-filter"), sort: $("#sort-select"),
  reset: $("#reset-button"), empty: $("#empty-state"), warning: $("#enhancement-warning"),
};
const nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const finite = (value) => value === null || value === undefined || value === "" ? NaN : Number(value);
const bool = (value) => value === true || value === "yes" || value === 1 ? true : value === false || value === "no" || value === 0 ? false : null;
const safeUrl = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } };
const percent = (n) => Number.isFinite(n) ? `${nf.format(n)}%` : "暂无数据";
const latency = (n) => !Number.isFinite(n) ? "暂无数据" : n >= 1000 ? `${nf.format(n / 1000)} 秒` : `${Math.round(n)} 毫秒`;
const dateText = (date) => date ? date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1 年 $2 月 $3 日") : "待确认";
const quality = (type, n) => !Number.isFinite(n) ? "unknown" : type === "uptime" ? n >= 99.5 ? "good" : n >= 97.5 ? "medium" : "poor" : n <= 5000 ? "good" : n <= 7500 ? "medium" : "poor";

function normalize(site, index) {
  const models = Array.isArray(site.models) ? site.models.filter(Boolean).map(String) : [];
  return { rank: Number(site.rank) || index + 1, name: String(site.name || "未命名站点"), url: safeUrl(site.url),
    description: String(site.description || "").replace(/\s+/g, " ").trim(), establishedDate: String(site.establishedDate || ""),
    modelCount: Number.isFinite(Number(site.modelCount)) ? Number(site.modelCount) : models.length, models,
    uptime: finite(site.uptime), latencyMs: finite(site.latencyMs), userRating: finite(site.userRating),
    ratingCount: finite(site.ratingCount), paymentMethods: Array.isArray(site.paymentMethods) ? site.paymentMethods.filter(Boolean).map(String) : [],
    supportsRefund: bool(site.supportsRefund), supportsInvoice: bool(site.supportsInvoice) };
}

function fallback(site) {
  const bits = site.models.length ? [`公开数据收录 ${site.modelCount} 个模型，主要覆盖 ${site.models.slice(0, 4).join("、")}${site.models.length > 4 ? "等厂商" : ""}`]
    : site.modelCount ? [`公开数据收录 ${site.modelCount} 个模型，厂商明细待补充`] : [];
  if (site.paymentMethods.length) bits.push(`已知支持 ${site.paymentMethods.join("、")}付款`);
  return `${bits.join("；") || "当前仅收录基础站点信息"}。具体服务能力和价格请以来源详情页为准。`;
}
const tags = (values, fallbackText) => !values.length ? `<span class="tag tag--muted">${fallbackText}</span>`
  : values.slice(0, 3).map((v) => `<span class="tag">${escapeHtml(v)}</span>`).join("") + (values.length > 3 ? `<span class="tag tag--more">+${values.length - 3}</span>` : "");
const policy = (value) => value === true ? '<span class="status status--yes">支持</span>' : value === false ? '<span class="status status--no">不支持</span>' : '<span class="status status--unknown">待确认</span>';

function row(site) {
  const description = site.description || fallback(site);
  const width = Number.isFinite(site.uptime) ? Math.max(0, Math.min(100, site.uptime)) : 0;
  return `<tr data-rank="${site.rank}"><td class="rank-cell"><span class="rank-badge${site.rank <= 3 ? ` rank-badge--${site.rank}` : ""}">${site.rank}</span></td>
  <th class="site-cell" scope="row"><div class="site-heading"><span class="avatar">${escapeHtml(Array.from(site.name)[0] || "A")}</span><div><a href="${escapeHtml(site.url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(site.name)} <span aria-hidden="true">↗</span></a><small>查看来源详情</small></div></div><p class="site-description">${escapeHtml(description)}</p><p class="site-date"><span>创建时间</span> ${escapeHtml(dateText(site.establishedDate))}</p></th>
  <td><div class="quality"><div><span>在线率</span><strong class="${quality("uptime", site.uptime)}">${percent(site.uptime)}</strong><i class="bar ${quality("uptime", site.uptime)}"><b style="width:${width}%"></b></i></div><div><span>平均延迟</span><strong class="${quality("latency", site.latencyMs)}">${latency(site.latencyMs)}</strong></div></div></td>
  <td class="models-cell"><strong>${nf.format(site.modelCount)} <small>个模型</small></strong><div class="tags">${tags(site.models, "暂无厂商明细")}</div></td>
  <td class="rating-cell">${Number.isFinite(site.userRating) ? `<strong>${site.userRating.toFixed(1)} <span>★</span></strong><small>${nf.format(site.ratingCount)} 条评价</small>` : "<strong>—</strong><small>暂无评分</small>"}</td>
  <td><div class="tags">${tags(site.paymentMethods, "未注明")}</div></td><td><div class="policies"><div><span>退款</span>${policy(site.supportsRefund)}</div><div><span>发票</span>${policy(site.supportsInvoice)}</div></div></td></tr>`;
}

function visible() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  return state.sites.filter((site) => {
    const text = [site.name, site.description || fallback(site), site.establishedDate, ...site.models, ...site.paymentMethods].join(" ").toLocaleLowerCase("zh-CN");
    const service = state.service === "refund" ? site.supportsRefund === true : state.service === "invoice" ? site.supportsInvoice === true
      : state.service === "both" ? site.supportsRefund === true && site.supportsInvoice === true : true;
    return (!query || text.includes(query)) && (state.vendor === "all" || site.models.includes(state.vendor)) && service;
  }).sort((a, b) => {
    const missing = (value, fallbackValue) => Number.isFinite(value) ? value : fallbackValue;
    let result = state.sort === "uptime" ? missing(b.uptime, -1) - missing(a.uptime, -1)
      : state.sort === "latency" ? missing(a.latencyMs, Infinity) - missing(b.latencyMs, Infinity)
      : state.sort === "models" ? b.modelCount - a.modelCount
      : state.sort === "rating" ? missing(b.userRating, -1) - missing(a.userRating, -1)
      : state.sort === "established" ? (a.establishedDate || "9999").localeCompare(b.establishedDate || "9999")
      : a.rank - b.rank;
    return result || a.rank - b.rank;
  });
}

function render() {
  const sites = visible();
  elements.body.innerHTML = sites.map(row).join("");
  elements.summary.textContent = `显示 ${nf.format(sites.length)} / ${nf.format(state.sites.length)} 家站点`;
  elements.empty.hidden = sites.length > 0;
  elements.body.closest(".table-wrap").hidden = sites.length === 0;
}

function populate() {
  [...new Set(state.sites.flatMap((site) => site.models))].sort((a, b) => a.localeCompare(b, "zh-CN"))
    .forEach((vendor) => elements.vendor.add(new Option(vendor, vendor)));
}

async function enhance() {
  try {
    const response = await fetch("./data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.sites)) throw new Error("缺少 sites 数组");
    state.sites = data.sites.map(normalize);
    populate();
  } catch (error) {
    console.error(error);
    elements.warning.hidden = false;
    [elements.search, elements.vendor, elements.service, elements.sort, elements.reset].forEach((item) => { item.disabled = true; });
  }
}

elements.search.addEventListener("input", (event) => { state.query = event.target.value; render(); });
elements.vendor.addEventListener("change", (event) => { state.vendor = event.target.value; render(); });
elements.service.addEventListener("change", (event) => { state.service = event.target.value; render(); });
elements.sort.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
elements.reset.addEventListener("click", () => {
  Object.assign(state, { query: "", vendor: "all", service: "all", sort: "rank" });
  elements.search.value = ""; elements.vendor.value = "all"; elements.service.value = "all"; elements.sort.value = "rank"; render();
});

enhance();
