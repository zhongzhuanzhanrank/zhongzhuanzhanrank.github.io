import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data.json");
const indexPath = path.join(root, "index.html");
const sitemapPath = path.join(root, "sitemap.xml");
const origin = "https://zhongzhuanzhanrank.github.io";
const sourceUrl = process.env.DATA_SOURCE_URL
  || "https://raw.githubusercontent.com/hvoyai/awesome-ai-api/main/data.json";
const shouldSync = process.argv.includes("--sync");
const checkOnly = process.argv.includes("--check");
const nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const finite = (value) => value === null || value === undefined || value === ""
  ? NaN : Number.isFinite(Number(value)) ? Number(value) : NaN;

function bool(value) {
  if (value === true || value === "yes" || value === 1) return true;
  if (value === false || value === "no" || value === 0) return false;
  return null;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}

function normalize(site, index) {
  const models = Array.isArray(site.models) ? site.models.filter(Boolean).map(String) : [];
  const payments = Array.isArray(site.paymentMethods) ? site.paymentMethods.filter(Boolean).map(String) : [];
  return {
    rank: Number(site.rank) || index + 1,
    name: String(site.name || "未命名站点"),
    url: safeUrl(site.url),
    description: String(site.description || "").replace(/\s+/g, " ").trim(),
    establishedDate: /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(site.establishedDate || "")
      ? String(site.establishedDate) : "",
    modelCount: Number.isFinite(Number(site.modelCount)) ? Number(site.modelCount) : models.length,
    models,
    uptime: finite(site.uptime), latencyMs: finite(site.latencyMs),
    userRating: finite(site.userRating), ratingCount: finite(site.ratingCount),
    paymentMethods: payments,
    supportsRefund: bool(site.supportsRefund), supportsInvoice: bool(site.supportsInvoice),
  };
}

function validate(data) {
  if (!data || !Array.isArray(data.sites) || !data.sites.length) throw new Error("data.json 缺少非空 sites 数组");
  data.sites.forEach((site, index) => {
    if (!site?.name) throw new Error(`第 ${index + 1} 条站点缺少 name`);
  });
}

async function sync() {
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "zhongzhuanzhanrank-static-generator/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`同步失败：HTTP ${response.status}`);
  const text = await response.text();
  const incoming = JSON.parse(text);
  validate(incoming);
  let current;
  try { current = JSON.parse(await readFile(dataPath, "utf8")); } catch { current = null; }
  if (current?.updatedDate && incoming.updatedDate && incoming.updatedDate < current.updatedDate) {
    throw new Error(`拒绝旧快照：${incoming.updatedDate} < ${current.updatedDate}`);
  }
  await writeFile(dataPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

const percent = (n) => Number.isFinite(n) ? `${nf.format(n)}%` : "暂无数据";
const latency = (n) => !Number.isFinite(n) ? "暂无数据" : n >= 1000 ? `${nf.format(n / 1000)} 秒` : `${Math.round(n)} 毫秒`;
const dateText = (date) => date ? date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1 年 $2 月 $3 日") : "待确认";
const quality = (type, n) => !Number.isFinite(n) ? "unknown" : type === "uptime"
  ? n >= 99.5 ? "good" : n >= 97.5 ? "medium" : "poor"
  : n <= 5000 ? "good" : n <= 7500 ? "medium" : "poor";

function fallbackDescription(site) {
  const parts = [];
  if (site.models.length) parts.push(`公开数据收录 ${site.modelCount} 个模型，主要覆盖 ${site.models.slice(0, 4).join("、")}${site.models.length > 4 ? "等厂商" : ""}`);
  else if (site.modelCount) parts.push(`公开数据收录 ${site.modelCount} 个模型，厂商明细待补充`);
  if (site.paymentMethods.length) parts.push(`已知支持 ${site.paymentMethods.join("、")}付款`);
  return `${parts.join("；") || "当前仅收录基础站点信息"}。具体服务能力和价格请以来源详情页为准。`;
}

function tags(values, fallback) {
  if (!values.length) return `<span class="tag tag--muted">${fallback}</span>`;
  return values.slice(0, 3).map((v) => `<span class="tag">${escapeHtml(v)}</span>`).join("")
    + (values.length > 3 ? `<span class="tag tag--more">+${values.length - 3}</span>` : "");
}

function policy(value) {
  if (value === true) return '<span class="status status--yes">支持</span>';
  if (value === false) return '<span class="status status--no">不支持</span>';
  return '<span class="status status--unknown">待确认</span>';
}

function row(site) {
  const desc = site.description || fallbackDescription(site);
  const initial = Array.from(site.name)[0] || "A";
  const width = Number.isFinite(site.uptime) ? Math.max(0, Math.min(100, site.uptime)) : 0;
  return `          <tr data-rank="${site.rank}">
            <td class="rank-cell"><span class="rank-badge${site.rank <= 3 ? ` rank-badge--${site.rank}` : ""}">${site.rank}</span></td>
            <th class="site-cell" scope="row">
              <div class="site-heading"><span class="avatar">${escapeHtml(initial)}</span><div><a href="${escapeHtml(site.url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(site.name)} <span aria-hidden="true">↗</span></a><small>查看来源详情</small></div></div>
              <p class="site-description">${escapeHtml(desc)}</p>
              <p class="site-date"><span>创建时间</span> ${escapeHtml(dateText(site.establishedDate))}</p>
            </th>
            <td><div class="quality"><div><span>在线率</span><strong class="${quality("uptime", site.uptime)}">${percent(site.uptime)}</strong><i class="bar ${quality("uptime", site.uptime)}"><b style="width:${width}%"></b></i></div><div><span>平均延迟</span><strong class="${quality("latency", site.latencyMs)}">${latency(site.latencyMs)}</strong></div></div></td>
            <td class="models-cell"><strong>${nf.format(site.modelCount)} <small>个模型</small></strong><div class="tags">${tags(site.models, "暂无厂商明细")}</div></td>
            <td class="rating-cell">${Number.isFinite(site.userRating) ? `<strong>${site.userRating.toFixed(1)} <span>★</span></strong><small>${nf.format(site.ratingCount)} 条评价</small>` : "<strong>—</strong><small>暂无评分</small>"}</td>
            <td><div class="tags">${tags(site.paymentMethods, "未注明")}</div></td>
            <td><div class="policies"><div><span>退款</span>${policy(site.supportsRefund)}</div><div><span>发票</span>${policy(site.supportsInvoice)}</div></div></td>
          </tr>`;
}

function buildFaq(total, date) {
  return [
    ["这份 AI 中转站排行榜的数据来自哪里？", `榜单数据同步自 HVOY 公开数据源，当前收录 ${total} 家站点，快照日期为 ${date}。页面对公开字段进行整理和静态展示。`],
    ["创建时间代表什么？", "创建时间使用上游数据中的 establishedDate 字段；为空时显示“待确认”。它不等于本排行榜的数据更新时间。"],
    ["在线率和延迟能代表实际体验吗？", "不能完全代表。监测结果会受到时间、地区、运营商和上游线路影响。正式使用前应以自己的网络和真实请求做小额测试。"],
    ["为什么有些站点没有介绍或评分？", "不同站点的公开资料完整度不同。缺失介绍时页面只根据已有模型和支付字段生成中性摘要；缺失指标不会按零计算。"],
    ["排名靠前就一定更适合吗？", "不一定。请结合目标模型、在线率、延迟、支付方式、退款和发票需求筛选，避免仅凭综合名次作决定。"],
  ];
}

function structuredData(sites, data, faq) {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "WebSite", "@id": `${origin}/#website`, url: `${origin}/`, name: "中转站排行", inLanguage: "zh-CN" },
    { "@type": "CollectionPage", "@id": `${origin}/#webpage`, url: `${origin}/`, name: `${data.updatedDate?.slice(0, 4) || "2026"} AI 中转站排行榜`, dateModified: data.updatedDate || data.generatedAt, isPartOf: { "@id": `${origin}/#website` }, inLanguage: "zh-CN" },
    { "@type": "Dataset", "@id": `${origin}/#dataset`, name: "AI 中转站排行榜数据", description: `收录 ${sites.length} 家 AI API 中转站的排名、描述、创建时间、在线率、延迟、模型、评分、支付和服务政策。`, dateModified: data.updatedDate || data.generatedAt, url: `${origin}/`, distribution: { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${origin}/data.json` } },
    { "@type": "ItemList", "@id": `${origin}/#ranking`, numberOfItems: sites.length, itemListOrder: "https://schema.org/ItemListOrderAscending", itemListElement: sites.map((s) => ({ "@type": "ListItem", position: s.rank, name: s.name, url: s.url, description: s.description || fallbackDescription(s), ...(s.establishedDate ? { dateCreated: s.establishedDate } : {}) })) },
    { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ] }, null, 2).replaceAll("<", "\\u003c");
}

function html(data, sites) {
  const year = data.updatedDate?.slice(0, 4) || "2026";
  const date = data.updatedDate || "最近一次同步";
  const uptimes = sites.map((s) => s.uptime).filter(Number.isFinite);
  const latencies = sites.map((s) => s.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const vendors = new Set(sites.flatMap((s) => s.models));
  const descriptions = sites.filter((s) => s.description).length;
  const dates = sites.filter((s) => s.establishedDate).length;
  const median = latencies[Math.floor(latencies.length / 2)];
  const faq = buildFaq(sites.length, date);
  const meta = `${year} AI 中转站排行榜，基于公开数据对比 ${sites.length} 家 API 服务的站点介绍、创建时间、在线率、响应延迟、模型覆盖、用户评分、支付方式、退款与发票信息。数据更新于 ${date}。`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${year} AI 中转站排行榜：${sites.length} 家 API 服务对比｜中转站排行</title>
  <meta name="description" content="${escapeHtml(meta)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"><meta name="theme-color" content="#111827">
  <link rel="canonical" href="${origin}/"><link rel="alternate" hreflang="zh-CN" href="${origin}/"><link rel="alternate" hreflang="x-default" href="${origin}/">
  <link rel="sitemap" type="application/xml" href="${origin}/sitemap.xml"><link rel="icon" href="./favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="./styles.css">
  <meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="中转站排行"><meta property="og:url" content="${origin}/">
  <meta property="og:title" content="${year} AI 中转站排行榜：${sites.length} 家 API 服务对比"><meta property="og:description" content="${escapeHtml(meta)}"><meta property="og:image" content="${origin}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${year} AI 中转站排行榜"><meta name="twitter:description" content="${escapeHtml(meta)}"><meta name="twitter:image" content="${origin}/og-image.png">
  <script type="application/ld+json">${structuredData(sites, data, faq)}</script>
</head>
<body>
<a class="skip-link" href="#ranking">跳到排行榜</a>
<header class="header"><div class="shell nav"><a class="brand" href="${origin}/"><span class="logo">ZR</span><span><b>中转站排行</b><small>AI RELAY DIRECTORY</small></span></a><nav aria-label="主导航"><a href="#ranking">排行榜</a><a href="#method">数据说明</a><a href="#faq">常见问题</a></nav></div></header>
<main>
<section class="hero"><div class="shell hero-grid"><div><p class="kicker">${year} · 公开数据快照</p><h1>AI 中转站<br><em>排行榜</em></h1><p class="lead">对比 ${sites.length} 家 AI API 中转服务的站点介绍、创建时间、在线率、延迟、模型覆盖和服务政策。</p><div class="hero-actions"><a href="#ranking">查看排行榜 <span>↓</span></a><p>数据更新于 <time datetime="${date}">${date}</time></p></div></div><aside class="snapshot"><p><span>DATA SNAPSHOT</span><b>● 已生成静态快照</b></p><dl><div><dt>收录站点</dt><dd>${nf.format(sites.length)}</dd></div><div><dt>有站点介绍</dt><dd>${nf.format(descriptions)}</dd></div><div><dt>有创建日期</dt><dd>${nf.format(dates)}</dd></div><div><dt>模型厂商</dt><dd>${nf.format(vendors.size)}</dd></div></dl></aside></div></section>
<section class="signals"><div class="shell"><p><b>01</b> 长期在线率优先</p><p><b>02</b> 延迟需本地实测</p><p><b>03</b> 创建日期不等于更新时间</p><p><b>04</b> 先小额测试再充值</p></div></section>
<section class="ranking shell" id="ranking"><div class="section-title"><div><p>01 / RANKING</p><h2>${year} AI 中转站排行榜</h2></div><p id="result-summary" aria-live="polite">共 ${nf.format(sites.length)} 家站点</p></div>
<div class="seo-summary"><h3>当前榜单摘要</h3><p>本页静态收录 ${sites.length} 家 AI 中转站，其中 ${descriptions} 家提供站点介绍、${dates} 家提供创建日期；${uptimes.length} 家有在线率数据、${latencies.length} 家有延迟数据。当前有数据站点的延迟中位数约为 ${latency(median)}。缺失信息明确标注，不按零值推断。</p></div>
<div class="controls"><label class="search"><span>搜索站点、介绍或模型</span><input id="search-input" type="search" placeholder="例如 Claude、支付宝、DuiAPI"></label><label><span>模型厂商</span><select id="vendor-filter"><option value="all">全部厂商</option></select></label><label><span>服务政策</span><select id="service-filter"><option value="all">全部政策</option><option value="refund">支持退款</option><option value="invoice">支持发票</option><option value="both">退款与发票</option></select></label><label><span>排序</span><select id="sort-select"><option value="rank">综合排名</option><option value="uptime">在线率最高</option><option value="latency">延迟最低</option><option value="models">模型最多</option><option value="rating">评分最高</option><option value="established">创建时间较早</option></select></label><button id="reset-button" type="button">重置</button></div>
<div id="enhancement-warning" class="notice" hidden>动态筛选暂不可用，下方静态排行榜仍可正常阅读。</div><div id="empty-state" class="empty" hidden><b>没有匹配结果</b><span>请缩短关键词或重置筛选。</span></div>
<div class="table-wrap"><table><caption>AI 中转站综合信息对比</caption><thead><tr><th class="rank-column">排名</th><th class="site-column">站点介绍与创建时间</th><th>运行质量</th><th>模型覆盖</th><th>用户评分</th><th>支付方式</th><th>服务政策</th></tr></thead><tbody id="ranking-body">
${sites.map(row).join("\n")}
</tbody></table></div><p class="table-note">站点介绍、创建时间及指标均来自公开数据快照；内容可能变化，请以来源详情和站点最新规则为准。</p></section>
<section class="method" id="method"><div class="shell"><div class="section-title"><div><p>02 / METHODOLOGY</p><h2>数据说明与选站原则</h2></div></div><div class="cards"><article><b>01</b><h3>数据来源</h3><p>数据同步自 HVOY 的公开仓库快照，当前日期为 ${date}。HTML 在构建时静态生成，搜索引擎无需运行 JavaScript 即可读取完整榜单。</p></article><article><b>02</b><h3>创建时间</h3><p>使用数据中的 establishedDate 字段，表示公开记录的站点成立日期。暂无记录时显示“待确认”，不会用榜单更新时间替代。</p></article><article><b>03</b><h3>数据缺失</h3><p>空字段不会被当作零值。介绍缺失时只根据模型、支付等已知字段形成中性摘要，不作稳定性和信誉背书。</p></article><article><b>04</b><h3>选站建议</h3><p>重点比较长期在线率、延迟波动、目标模型兼容性和账单透明度。正式使用前请在自己的网络环境中小额测试。</p></article></div></div></section>
<section class="faq shell" id="faq"><div class="section-title"><div><p>03 / FAQ</p><h2>常见问题</h2></div></div><div class="faq-list">${faq.map(([q,a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("")}</div></section>
</main>
<footer><div class="shell"><div class="brand"><span class="logo">ZR</span><span><b>中转站排行</b><small>AI RELAY DIRECTORY</small></span></div><p>公开数据整理 · 不构成购买、充值或服务背书</p></div></footer>
<script src="./app.js" defer></script></body></html>\n`;
}

async function main() {
  if (shouldSync) await sync();
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  validate(data);
  const sites = data.sites.map(normalize).sort((a, b) => a.rank - b.rank);
  const output = html(data, sites);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc><lastmod>${data.updatedDate || data.generatedAt?.slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>\n`;
  if (checkOnly) {
    if ((output.match(/<tr data-rank=/g) || []).length !== sites.length) throw new Error("静态行数不匹配");
    process.stdout.write(`检查通过：${sites.length} 条静态记录\n`); return;
  }
  await writeFile(indexPath, output, "utf8");
  await writeFile(sitemapPath, sitemap, "utf8");
  process.stdout.write(`已生成 ${sites.length} 条静态记录\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
