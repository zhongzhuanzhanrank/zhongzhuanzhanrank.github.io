const PAGE_SIZE = 100;

const state = {
  sites: [],
  query: "",
  vendor: "all",
  sortBy: "rank",
  visibleCount: PAGE_SIZE,
};

const elements = {
  siteCount: document.querySelector("#site-count"),
  averageUptime: document.querySelector("#average-uptime"),
  averageLatency: document.querySelector("#average-latency"),
  vendorCount: document.querySelector("#vendor-count"),
  updatedAt: document.querySelector("#updated-at"),
  resultSummary: document.querySelector("#result-summary"),
  searchInput: document.querySelector("#search-input"),
  vendorFilter: document.querySelector("#vendor-filter"),
  sortSelect: document.querySelector("#sort-select"),
  resetButton: document.querySelector("#reset-button"),
  retryButton: document.querySelector("#retry-button"),
  loadMoreButton: document.querySelector("#load-more-button"),
  rankingBody: document.querySelector("#ranking-body"),
  loadingState: document.querySelector("#loading-state"),
  errorState: document.querySelector("#error-state"),
  emptyState: document.querySelector("#empty-state"),
  tableContainer: document.querySelector("#table-container"),
};

const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeSite(site, index) {
  const models = Array.isArray(site.models) ? site.models.filter(Boolean).map(String) : [];
  const paymentMethods = Array.isArray(site.paymentMethods)
    ? site.paymentMethods.filter(Boolean).map(String)
    : [];
  const modelCount = Number(site.modelCount ?? models.length);

  return {
    rank: Number(site.rank) || index + 1,
    name: String(site.name || "未命名站点"),
    url: String(site.url || "#"),
    modelCount: Number.isFinite(modelCount) ? modelCount : models.length,
    models,
    uptime: toFiniteNumber(site.uptime),
    latencyMs: toFiniteNumber(site.latencyMs),
    userRating: toFiniteNumber(site.userRating),
    ratingCount: toFiniteNumber(site.ratingCount),
    paymentMethods,
  };
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "链接未配置";
  }
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${numberFormatter.format(value)}%` : "—";
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${numberFormatter.format(value / 1000)} s`;
  return `${Math.round(value)} ms`;
}

function qualityClass(type, value) {
  if (!Number.isFinite(value)) return "medium";
  if (type === "uptime") {
    if (value >= 99.5) return "good";
    if (value >= 97.5) return "medium";
    return "poor";
  }
  if (value <= 5000) return "good";
  if (value <= 7500) return "medium";
  return "poor";
}

function renderTags(values, fallback) {
  if (!values.length) return `<span class="tag">${fallback}</span>`;
  const visible = values.slice(0, 3).map((value) => `<span class="tag">${escapeHtml(value)}</span>`);
  if (values.length > 3) visible.push(`<span class="tag more">+${values.length - 3}</span>`);
  return visible.join("");
}

function renderRating(site) {
  if (!Number.isFinite(site.userRating)) {
    return '<div class="rating-score"><strong>—</strong><span>★</span></div><span class="rating-caption">暂无评分</span>';
  }
  const count = Number.isFinite(site.ratingCount) ? `${numberFormatter.format(site.ratingCount)} 条评价` : "评价数未知";
  return `<div class="rating-score"><strong>${site.userRating.toFixed(1)}</strong><span>★</span></div><span class="rating-caption">${escapeHtml(count)}</span>`;
}

function renderSite(site) {
  const uptimeClass = qualityClass("uptime", site.uptime);
  const latencyClass = qualityClass("latency", site.latencyMs);
  const uptimeWidth = Number.isFinite(site.uptime) ? Math.min(100, Math.max(0, site.uptime)) : 0;
  const initial = Array.from(site.name.trim())[0] || "A";
  const rankClass = site.rank === 1 ? " top first" : site.rank <= 3 ? " top" : "";
  const url = safeUrl(site.url);

  return `
    <tr>
      <td class="rank-cell"><span class="rank-number${rankClass}" aria-label="第 ${site.rank} 名">${site.rank}</span></td>
      <th class="site-cell" scope="row">
        <a class="site-link" href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">
          <span class="site-avatar">${escapeHtml(initial)}</span>
          <span>
            <span class="site-name">${escapeHtml(site.name)}</span>
            <small>${escapeHtml(getDomain(site.url))} ↗</small>
          </span>
        </a>
      </th>
      <td>
        <div class="quality">
          <div class="metric">
            <span>在线率</span>
            <strong class="${uptimeClass}">${formatPercent(site.uptime)}</strong>
            <span class="uptime-track ${uptimeClass}" aria-hidden="true"><i style="width:${uptimeWidth}%"></i></span>
          </div>
          <div class="metric">
            <span>平均延迟</span>
            <strong class="${latencyClass}">${formatLatency(site.latencyMs)}</strong>
          </div>
        </div>
      </td>
      <td class="model-cell">
        <div class="model-count"><strong>${numberFormatter.format(site.modelCount)}</strong><span>个模型</span></div>
        <div class="tag-list">${renderTags(site.models, "暂无厂商明细")}</div>
      </td>
      <td class="rating-cell">${renderRating(site)}</td>
      <td class="payment-cell"><div class="payment-list">${renderTags(site.paymentMethods, "未注明")}</div></td>
    </tr>`;
}

function getFilteredSites() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  return state.sites
    .filter((site) => {
      const searchable = [site.name, getDomain(site.url), ...site.models, ...site.paymentMethods]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      const matchesQuery = !query || searchable.includes(query);
      const matchesVendor = state.vendor === "all" || site.models.includes(state.vendor);
      return matchesQuery && matchesVendor;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (state.sortBy === "uptime") comparison = (Number.isFinite(b.uptime) ? b.uptime : -1) - (Number.isFinite(a.uptime) ? a.uptime : -1);
      else if (state.sortBy === "latency") comparison = (Number.isFinite(a.latencyMs) ? a.latencyMs : Infinity) - (Number.isFinite(b.latencyMs) ? b.latencyMs : Infinity);
      else if (state.sortBy === "models") comparison = b.modelCount - a.modelCount;
      else if (state.sortBy === "rating") comparison = (Number.isFinite(b.userRating) ? b.userRating : -1) - (Number.isFinite(a.userRating) ? a.userRating : -1);
      else comparison = a.rank - b.rank;
      return comparison || a.rank - b.rank;
    });
}

function setView(view) {
  elements.loadingState.hidden = view !== "loading";
  elements.errorState.hidden = view !== "error";
  elements.emptyState.hidden = view !== "empty";
  elements.tableContainer.hidden = view !== "ready";
}

function renderTable() {
  const filteredSites = getFilteredSites();
  const visibleSites = filteredSites.slice(0, state.visibleCount);
  elements.rankingBody.innerHTML = visibleSites.map(renderSite).join("");
  elements.resultSummary.textContent = `显示 ${numberFormatter.format(visibleSites.length)} / ${numberFormatter.format(filteredSites.length)} 个结果`;
  elements.loadMoreButton.hidden = visibleSites.length >= filteredSites.length;
  setView(filteredSites.length ? "ready" : "empty");
}

function renderSummary() {
  const uptimes = state.sites.map((site) => site.uptime).filter(Number.isFinite);
  const latencies = state.sites.map((site) => site.latencyMs).filter(Number.isFinite);
  const vendors = new Set(state.sites.flatMap((site) => site.models));
  const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;

  elements.siteCount.textContent = numberFormatter.format(state.sites.length);
  elements.averageUptime.textContent = uptimes.length ? formatPercent(average(uptimes)) : "—";
  elements.averageLatency.textContent = latencies.length ? formatLatency(average(latencies)) : "—";
  elements.vendorCount.textContent = numberFormatter.format(vendors.size);
}

function populateVendorFilter() {
  const vendors = [...new Set(state.sites.flatMap((site) => site.models))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  elements.vendorFilter.replaceChildren(new Option("全部厂商", "all"));
  vendors.forEach((vendor) => elements.vendorFilter.add(new Option(vendor, vendor)));
}

function formatUpdatedAt(data) {
  const value = data.updatedDate || data.updatedAt || data.generatedAt;
  if (!value) return "时间未知";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", ".");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function loadData() {
  setView("loading");
  elements.loadMoreButton.hidden = true;
  try {
    const response = await fetch("./data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rawSites = Array.isArray(data) ? data : data.sites;
    if (!Array.isArray(rawSites)) throw new Error("data.json 中缺少 sites 数组");

    state.sites = rawSites.map(normalizeSite);
    renderSummary();
    populateVendorFilter();
    elements.updatedAt.textContent = formatUpdatedAt(data);
    renderTable();
  } catch (error) {
    console.error(error);
    elements.resultSummary.textContent = "数据读取失败";
    setView("error");
  }
}

function resetFilters() {
  state.query = "";
  state.vendor = "all";
  state.sortBy = "rank";
  state.visibleCount = PAGE_SIZE;
  elements.searchInput.value = "";
  elements.vendorFilter.value = "all";
  elements.sortSelect.value = "rank";
  renderTable();
}

function updateAndRender() {
  state.visibleCount = PAGE_SIZE;
  renderTable();
}

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  updateAndRender();
});
elements.vendorFilter.addEventListener("change", (event) => {
  state.vendor = event.target.value;
  updateAndRender();
});
elements.sortSelect.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  updateAndRender();
});
elements.resetButton.addEventListener("click", resetFilters);
elements.retryButton.addEventListener("click", loadData);
elements.loadMoreButton.addEventListener("click", () => {
  state.visibleCount += PAGE_SIZE;
  renderTable();
});

loadData();
