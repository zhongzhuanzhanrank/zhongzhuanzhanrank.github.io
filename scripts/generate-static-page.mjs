import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data.json");
const PAGE_ROOT = path.join(ROOT, "page");
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");
const ORIGIN = "https://zhongzhuanzhanrank.github.io";
const PAGE_SIZE = 50;
const SOURCE_URL = process.env.DATA_SOURCE_URL
  || "https://raw.githubusercontent.com/hvoyai/awesome-ai-api/main/data.json";
const SHOULD_SYNC = process.argv.includes("--sync");
const CHECK_ONLY = process.argv.includes("--check");
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const FAQ = [
  ["AI 中转站排行榜的数据来自哪里？", "榜单依据公开站点资料和监测快照整理，展示站点介绍、成立日期、在线率、延迟、模型覆盖、支付方式以及退款和发票政策。指标会随线路和服务状态变化，请以实际测试为准。"],
  ["为什么这里的排名与其他榜单不同？", "本站在公开排名区间基础上采用独立、固定的排序规则，因此不会与其他站点保持完全相同的顺序，也不会在每次刷新时随机变化。排名用于辅助浏览，不代表购买或充值建议。"],
  ["排名靠前就一定更适合吗？", "不一定。综合排名只能帮助缩小范围。编程、长文档、图片和高并发任务关注的指标不同，正式接入前应使用自己的网络、模型和真实任务做小额测试。"],
  ["为什么建议先小额充值？", "中转服务会受到上游线路、模型政策、价格调整和运营状态影响。按近期用量充值并保留备用接口，可以降低余额和业务连续性风险。"],
  ["如何看待在线率和平均延迟？", "在线率适合观察长期可用性，平均延迟适合做初步筛选，但不同地区、运营商和请求类型的体验可能差异很大，不能替代本地连续测试。"],
  ["缺失的数据会按零计算吗？", "不会。没有公开记录的字段会标记为暂无或待确认，不会把缺失值当成零，也不会用榜单更新时间代替站点成立日期。"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value) {
  if (value === true || value === "yes" || value === 1) return true;
  if (value === false || value === "no" || value === 0) return false;
  return null;
}

function date(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalize(site, index) {
  const models = Array.isArray(site.models) ? site.models.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const payments = Array.isArray(site.paymentMethods) ? site.paymentMethods.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return {
    rank: Math.max(1, Math.round(finite(site.rank) || index + 1)),
    name: String(site.name || "未命名站点").trim(),
    url: safeUrl(site.url),
    description: String(site.description || "").replace(/\s+/g, " ").trim(),
    establishedDate: date(site.establishedDate),
    modelCount: Math.max(0, Math.round(finite(site.modelCount) ?? models.length)),
    models: [...new Set(models)],
    uptime: finite(site.uptime),
    latencyMs: finite(site.latencyMs),
    userRating: finite(site.userRating),
    ratingCount: Math.max(0, Math.round(finite(site.ratingCount) || 0)),
    paymentMethods: [...new Set(payments)],
    supportsRefund: boolean(site.supportsRefund),
    supportsInvoice: boolean(site.supportsInvoice),
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function reorderSites(sites) {
  const bandSize = 8;
  const reordered = [];
  for (let start = 0; start < sites.length; start += bandSize) {
    const band = sites.slice(start, start + bandSize).sort((left, right) => {
      const leftHash = stableHash(`${left.name}|${left.url}|zhongzhuanzhanrank`);
      const rightHash = stableHash(`${right.name}|${right.url}|zhongzhuanzhanrank`);
      return leftHash - rightHash || left.rank - right.rank;
    });
    reordered.push(...band);
  }
  return reordered.map((site, index) => ({ ...site, rank: index + 1 }));
}

function validate(data) {
  if (!data || !Array.isArray(data.sites) || !data.sites.length) {
    throw new Error("data.json 缺少非空 sites 数组");
  }
  data.sites.forEach((site, index) => {
    if (!String(site?.name || "").trim()) throw new Error(`第 ${index + 1} 条站点缺少 name`);
    if (!safeUrl(site?.url)) throw new Error(`第 ${index + 1} 条站点 URL 无效`);
  });
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

async function sync() {
  const response = await fetch(SOURCE_URL, {
    headers: { "user-agent": "zhongzhuanzhanrank-static-generator/2.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`同步失败：HTTP ${response.status}`);
  const incoming = JSON.parse(await response.text());
  validate(incoming);
  let current = null;
  try { current = JSON.parse(await readFile(DATA_PATH, "utf8")); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (current?.updatedDate && incoming.updatedDate && incoming.updatedDate < current.updatedDate) {
    throw new Error(`拒绝旧快照：${incoming.updatedDate} < ${current.updatedDate}`);
  }
  await atomicWrite(DATA_PATH, `${JSON.stringify(incoming, null, 2)}\n`);
}

function pagePath(page) {
  return page === 1 ? "/" : `/page/${page}/`;
}

function relativeRoot(page) {
  return page === 1 ? "." : "../..";
}

function formatDate(value) {
  if (!value) return "待确认";
  const [year, month, day] = value.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function formatUptime(value) {
  return value === null ? "暂无" : `${number.format(value)}%`;
}

function formatLatency(value) {
  if (value === null) return "暂无";
  return value >= 1000 ? `${number.format(value / 1000)} 秒` : `${Math.round(value)} 毫秒`;
}

function formatStatus(value) {
  return value === true ? "支持" : value === false ? "不支持" : "待确认";
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pageStats(sites) {
  const uptimes = sites.map((site) => site.uptime).filter((value) => value !== null);
  const latencies = sites.map((site) => site.latencyMs).filter((value) => value !== null);
  return {
    descriptions: sites.filter((site) => site.description).length,
    dates: sites.filter((site) => site.establishedDate).length,
    uptime: median(uptimes),
    uptimeSamples: uptimes.length,
    latency: median(latencies),
    latencySamples: latencies.length,
  };
}

function fallbackDescription(site) {
  const facts = [`综合排名第 ${site.rank}`];
  if (site.modelCount) facts.push(`收录 ${site.modelCount} 个模型`);
  if (site.models.length) facts.push(`覆盖 ${site.models.slice(0, 3).join("、")}${site.models.length > 3 ? "等厂商" : ""}`);
  if (site.paymentMethods.length) facts.push(`支持 ${site.paymentMethods.join("、")}付款`);
  return `${facts.join("，")}。目前公开介绍较少，具体能力和价格请查看来源详情并自行测试。`;
}

function objectiveSummary(site) {
  const facts = [`综合排名第 ${site.rank}`];
  if (site.establishedDate) facts.push(`成立日期 ${site.establishedDate}`);
  if (site.uptime !== null) facts.push(`在线率 ${formatUptime(site.uptime)}`);
  if (site.latencyMs !== null) facts.push(`平均延迟 ${formatLatency(site.latencyMs)}`);
  facts.push(`收录模型 ${site.modelCount} 个`);
  if (site.userRating !== null && site.ratingCount) facts.push(`用户评分 ${number.format(site.userRating)}/5`);
  return `${facts.join("；")}。`;
}

function renderTags(items, empty = "暂未注明") {
  if (!items.length) return `<span class="tag tag--muted">${empty}</span>`;
  const visible = items.slice(0, 5).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
  return visible + (items.length > 5 ? `<span class="tag tag--more">+${items.length - 5}</span>` : "");
}

function renderSite(site) {
  const description = site.description || fallbackDescription(site);
  const shortDescription = description.length > 170 ? `${description.slice(0, 170).trim()}…` : description;
  const rating = site.userRating !== null && site.ratingCount
    ? `${number.format(site.userRating)} / 5 · ${site.ratingCount} 条评价`
    : "暂无评分";
  return `          <article class="station-card" id="rank-${site.rank}" aria-labelledby="station-${site.rank}">
            <div class="station-card__head">
              <span class="rank-badge"><small>排名</small>${site.rank}</span>
              <div class="station-title"><h2 id="station-${site.rank}"><a href="${escapeHtml(site.url)}" target="_blank" rel="nofollow noopener" referrerpolicy="origin">${escapeHtml(site.name)}</a></h2><p>创建时间：${escapeHtml(formatDate(site.establishedDate))}</p></div>
            </div>
            <p class="site-summary">${escapeHtml(shortDescription)}</p>
${description.length > 170 ? `            <details class="site-intro"><summary>展开完整站点介绍</summary><p>${escapeHtml(description)}</p></details>\n` : ""}
            <dl class="metric-grid"><div><dt>在线率</dt><dd>${formatUptime(site.uptime)}</dd></div><div><dt>平均延迟</dt><dd>${formatLatency(site.latencyMs)}</dd></div><div><dt>模型数量</dt><dd>${site.modelCount} 个</dd></div><div><dt>用户评价</dt><dd>${escapeHtml(rating)}</dd></div></dl>
            <div class="station-meta"><div><h3>模型厂商</h3><div class="tag-list">${renderTags(site.models)}</div></div><div><h3>支付方式</h3><div class="tag-list">${renderTags(site.paymentMethods)}</div></div></div>
            <div class="station-card__foot"><p><span>退款：${formatStatus(site.supportsRefund)}</span><span>发票：${formatStatus(site.supportsInvoice)}</span></p><a class="detail-link" href="${escapeHtml(site.url)}" target="_blank" rel="nofollow noopener" referrerpolicy="origin" aria-label="查看 ${escapeHtml(site.name)} 的来源详情">查看来源详情 <span aria-hidden="true">↗</span></a></div>
          </article>`;
}

function renderBreadcrumbs(page, root) {
  if (page === 1) return '<nav class="breadcrumbs" aria-label="面包屑"><span aria-current="page">AI 中转站排行榜</span></nav>';
  return `<nav class="breadcrumbs" aria-label="面包屑"><a href="${root}/">AI 中转站排行榜</a><span aria-hidden="true">/</span><span aria-current="page">第 ${page} 页</span></nav>`;
}

function renderPagination(current, total) {
  const visible = new Set([1, total]);
  for (let page = Math.max(1, current - 2); page <= Math.min(total, current + 2); page += 1) visible.add(page);
  const pages = [...visible].sort((a, b) => a - b);
  const numbers = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) numbers.push('<span class="page-gap" aria-hidden="true">…</span>');
    numbers.push(page === current
      ? `<span class="page-number is-current" aria-current="page">${page}</span>`
      : `<a class="page-number" href="${pagePath(page)}" aria-label="前往第 ${page} 页">${page}</a>`);
    previous = page;
  }
  return `<nav class="pagination" aria-label="排行榜分页">${current > 1 ? `<a class="page-step" href="${pagePath(current - 1)}">← 上一页</a>` : '<span class="page-step is-disabled">← 上一页</span>'}<div class="page-numbers">${numbers.join("")}</div>${current < total ? `<a class="page-step" href="${pagePath(current + 1)}">下一页 →</a>` : '<span class="page-step is-disabled">下一页 →</span>'}</nav>`;
}

function renderAnalysis(stats, first, last, count) {
  return `<aside class="page-analysis" aria-labelledby="analysis-title"><div><p>PAGE DATA / ${first}–${last}</p><h3 id="analysis-title">本页数据概览</h3></div><p>本页 ${count} 家站点中，${stats.descriptions} 家有站点介绍，${stats.dates} 家有创建日期。在线率中位数为 ${stats.uptime === null ? "暂无" : formatUptime(stats.uptime)}（样本 ${stats.uptimeSamples}/${count}），延迟中位数为 ${stats.latency === null ? "暂无" : formatLatency(stats.latency)}（样本 ${stats.latencySamples}/${count}）。</p></aside>`;
}

function renderHomeContent(dateText) {
  const faq = FAQ.map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("");
  return `<section class="method" id="method"><div class="shell"><div class="section-heading"><p>02 / METHODOLOGY</p><h2>选择中转站时，先验证四件事</h2></div><div class="method-grid"><article><b>01</b><h3>连续可用性</h3><p>在不同时间段连续请求，记录成功率、首字等待和完整响应时间，不要只依赖一次测速。</p></article><article><b>02</b><h3>模型真实性</h3><p>核对版本、上下文、流式输出和工具调用。名称相同，不代表上游能力和限制完全相同。</p></article><article><b>03</b><h3>账单可复算</h3><p>检查输入、输出、缓存和倍率是否分别记录，确认单次调用成本能与用量明细对应。</p></article><article><b>04</b><h3>运营与售后</h3><p>关注公告、客服、退款和开票规则。先小额充值，为关键调用保留备用服务。</p></article></div><p class="data-note">榜单快照更新于 ${dateText}，缺失字段不会按零值计算。</p></div></section><section class="faq shell" id="faq"><div class="section-heading"><p>03 / FAQ</p><h2>常见问题</h2></div><div class="faq-list">${faq}</div></section>`;
}

function structuredData({ page, canonical, title, description, sites, totalSites, updatedDate }) {
  const breadcrumbId = `${canonical}#breadcrumb`;
  const graph = [{
    "@type": "WebSite", "@id": `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: "中转站排行", inLanguage: "zh-CN",
  }, {
    "@type": "CollectionPage", "@id": `${canonical}#webpage`, url: canonical, name: title, description,
    dateModified: updatedDate, inLanguage: "zh-CN", isPartOf: { "@id": `${ORIGIN}/#website` },
    breadcrumb: { "@id": breadcrumbId }, mainEntity: { "@id": `${canonical}#ranking` },
  }, {
    "@type": "BreadcrumbList", "@id": breadcrumbId,
    itemListElement: page === 1
      ? [{ "@type": "ListItem", position: 1, name: "AI 中转站排行榜", item: canonical }]
      : [{ "@type": "ListItem", position: 1, name: "AI 中转站排行榜", item: `${ORIGIN}/` }, { "@type": "ListItem", position: 2, name: `第 ${page} 页`, item: canonical }],
  }, {
    "@type": "ItemList", "@id": `${canonical}#ranking`, name: `${title}列表`, numberOfItems: totalSites,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: sites.map((site) => ({
      "@type": "ListItem", position: site.rank,
      item: { "@type": "Service", name: site.name, url: site.url, description: objectiveSummary(site), ...(site.establishedDate ? { dateCreated: site.establishedDate } : {}) },
    })),
  }];
  if (page === 1) {
    graph.push({
      "@type": "Dataset", "@id": `${ORIGIN}/#dataset`, name: "AI 中转站排行榜数据",
      description: `收录 ${totalSites} 家 AI API 中转站的排名与公开服务信息。`, dateModified: updatedDate,
      url: `${ORIGIN}/`, distribution: { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${ORIGIN}/data.json` },
    });
    graph.push({
      "@type": "FAQPage", mainEntity: FAQ.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replaceAll("<", "\\u003c");
}

function renderPage({ page, totalPages, sites, allSites, updatedDate }) {
  const root = relativeRoot(page);
  const year = updatedDate.slice(0, 4);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + sites.length - 1;
  const canonical = `${ORIGIN}${pagePath(page)}`;
  const title = page === 1
    ? `${year} AI 中转站排行榜：${allSites.length} 家 API 服务对比｜中转站排行`
    : `${year} AI 中转站排行榜第 ${page} 页：排名 ${first}–${last}｜中转站排行`;
  const description = page === 1
    ? `${year} AI 中转站排行榜，收录 ${allSites.length} 家 API 服务，对比在线率、延迟、模型覆盖、用户评分、支付方式、退款与发票信息。数据更新于 ${updatedDate}。`
    : `${year} AI 中转站排行榜第 ${page} 页，展示综合排名 ${first}–${last} 的 ${sites.length} 家 API 中转服务及在线率、延迟、模型、支付和服务政策。`;
  const previous = page > 1 ? `${ORIGIN}${pagePath(page - 1)}` : "";
  const next = page < totalPages ? `${ORIGIN}${pagePath(page + 1)}` : "";
  const stats = pageStats(sites);
  const jsonLd = structuredData({ page, canonical, title, description, sites, totalSites: allSites.length, updatedDate });
  const hero = page === 1
    ? `<p class="kicker">${year} · 公开数据快照</p><h1>AI 中转站<br><em>排行榜</em></h1><p class="lead">对比 ${allSites.length} 家 AI API 中转服务的运行表现、模型覆盖、支付方式和服务政策。</p><a class="primary-link" href="#ranking">查看排行榜 <span>↓</span></a>`
    : `<p class="kicker">RANKING PAGE ${String(page).padStart(2, "0")}</p><h1>AI 中转站排行<br><em>第 ${page} 页</em></h1><p class="lead">本页展示综合排名 ${first}–${last}。完整选择方法和常见问题可返回首页查看。</p><a class="primary-link" href="${root}/#method">阅读选择方法 <span>→</span></a>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"><meta name="theme-color" content="#111827">
  <link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="zh-CN" href="${canonical}"><link rel="alternate" hreflang="x-default" href="${canonical}">
  ${previous ? `<link rel="prev" href="${previous}">` : ""}${next ? `<link rel="next" href="${next}">` : ""}
  <link rel="sitemap" type="application/xml" href="${ORIGIN}/sitemap.xml"><link rel="icon" href="${root}/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${root}/styles.css?v=20260802-2">
  <meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="中转站排行"><meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${ORIGIN}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${ORIGIN}/og-image.png">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<a class="skip-link" href="#main">跳到主要内容</a>
<header class="header"><div class="shell nav"><a class="brand" href="${root}/" aria-label="中转站排行首页"><span class="logo">ZR</span><span><b>中转站排行</b><small>AI RELAY DIRECTORY</small></span></a><nav aria-label="主导航"><a href="${root}/#ranking">排行榜</a><a href="${root}/#method">怎么选</a><a href="${root}/#faq">常见问题</a></nav></div></header>
<main id="main">
${renderBreadcrumbs(page, root)}
<section class="hero shell"><div>${hero}</div><aside class="snapshot"><p><span>DATA SNAPSHOT</span><b>● 独立分页快照</b></p><strong>${allSites.length}</strong><span>家 AI API 中转站</span><dl><div><dt>当前页</dt><dd>${page} / ${totalPages}</dd></div><div><dt>本页排名</dt><dd>${first}–${last}</dd></div><div><dt>更新时间</dt><dd>${updatedDate}</dd></div></dl></aside></section>
<section class="signals"><div class="shell"><p><b>01</b> 先比较再小额测试</p><p><b>02</b> 关注长期在线率</p><p><b>03</b> 延迟需本地验证</p><p><b>04</b> 为关键调用留备用</p></div></section>
<section class="ranking shell" id="ranking" aria-labelledby="ranking-title"><div class="section-heading section-heading--split"><div><p>01 / RANKING · PAGE ${page}</p><h2 id="ranking-title">${year} AI 中转站排行榜</h2></div><p>当前显示第 ${first}–${last} 名，共 ${allSites.length} 家</p></div>${renderAnalysis(stats, first, last, sites.length)}<div class="station-list">${sites.map(renderSite).join("\n")}</div>${renderPagination(page, totalPages)}</section>
${page === 1 ? renderHomeContent(updatedDate) : `<section class="page-continue shell"><p>已浏览第 ${page} 页</p><h2>返回首页，查看完整的中转站选择方法</h2><a class="primary-link" href="${root}/#method">阅读选择方法 <span>→</span></a></section>`}
</main>
<footer><div class="shell"><a class="brand" href="${root}/"><span class="logo">ZR</span><span><b>中转站排行</b><small>AI RELAY DIRECTORY</small></span></a><p>公开信息整理 · 不构成购买、充值或服务背书</p><a href="#main">返回顶部 ↑</a></div></footer>
</body></html>\n`;
}

function renderSitemap(totalPages, updatedDate) {
  const urls = Array.from({ length: totalPages }, (_, index) => `${ORIGIN}${pagePath(index + 1)}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url, index) => `  <url><loc>${url}</loc><lastmod>${updatedDate}</lastmod><changefreq>daily</changefreq><priority>${index === 0 ? "1.0" : "0.8"}</priority></url>`).join("\n")}
</urlset>\n`;
}

async function cleanOldPages(totalPages) {
  let entries = [];
  try { entries = await readdir(PAGE_ROOT, { withFileTypes: true }); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name) && Number(entry.name) > totalPages)
    .map((entry) => rm(path.join(PAGE_ROOT, entry.name), { recursive: true, force: true })));
}

function verifyPages(pages, totalSites) {
  const ranks = pages.flatMap((html) => [...html.matchAll(/class="station-card" id="rank-(\d+)"/g)].map((match) => Number(match[1])));
  if (ranks.length !== totalSites || new Set(ranks).size !== totalSites) throw new Error("分页站点数量或排名不完整");
  pages.forEach((html, index) => {
    const page = index + 1;
    if ((html.match(/<article class="station-card"/g) || []).length > PAGE_SIZE) throw new Error(`第 ${page} 页超过 ${PAGE_SIZE} 条`);
    if (!html.includes(`<link rel="canonical" href="${ORIGIN}${pagePath(page)}">`)) throw new Error(`第 ${page} 页 canonical 错误`);
    if (/rel="[^"]*noreferrer/.test(html)) throw new Error(`第 ${page} 页仍包含 noreferrer`);
    for (const link of html.matchAll(/href="(https:\/\/www\.hvoy\.ai\/sites\/[^"]+)"[^>]*rel="([^"]+)"[^>]*referrerpolicy="([^"]+)"/g)) {
      if (link[2] !== "nofollow noopener" || link[3] !== "origin") throw new Error(`第 ${page} 页外链策略错误`);
    }
  });
}

async function main() {
  if (SHOULD_SYNC) await sync();
  const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
  validate(data);
  const sites = reorderSites(data.sites.map(normalize).sort((a, b) => a.rank - b.rank));
  const updatedDate = date(data.updatedDate) || String(data.generatedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const totalPages = Math.ceil(sites.length / PAGE_SIZE);
  const pages = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return renderPage({ page, totalPages, sites: sites.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE), allSites: sites, updatedDate });
  });
  verifyPages(pages, sites.length);
  if (CHECK_ONLY) {
    process.stdout.write(`检查通过：${totalPages} 个静态分页，${sites.length} 家站点\n`);
    return;
  }
  await cleanOldPages(totalPages);
  await Promise.all(pages.map((html, index) => {
    const page = index + 1;
    const target = page === 1 ? path.join(ROOT, "index.html") : path.join(PAGE_ROOT, String(page), "index.html");
    return atomicWrite(target, html);
  }));
  await atomicWrite(SITEMAP_PATH, renderSitemap(totalPages, updatedDate));
  process.stdout.write(`已生成 ${totalPages} 个静态分页，共 ${sites.length} 家站点\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
