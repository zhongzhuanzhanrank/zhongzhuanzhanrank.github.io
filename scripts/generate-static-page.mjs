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
  ["什么是 AI API 中转站？", "中转站位于你的应用与模型厂商之间：你把请求发送给中转站，中转站完成鉴权、路由和计费，再将请求转发到模型厂商或其上游渠道。它通常能降低支付和接入门槛，并用一个 Key 提供多个模型，但也增加了第三方可用性、隐私和经营连续性风险。"],
  ["中转 API、官方 API 和 ChatGPT、Claude 订阅有什么区别？", "官方 API 按实际 Token 或请求量计费，适合程序调用；ChatGPT Plus、Claude Pro 等订阅主要面向网页或官方客户端，不等于可以无限调用 API；中转 API 则由第三方提供兼容接口和人民币结算。不要把订阅额度、API 额度和中转余额混为一谈。"],
  ["什么情况下更适合直接使用官方 API？", "涉及客户隐私、商业机密、受监管数据、长期生产服务或需要官方 SLA 时，应优先选择官方 API 或具备正式合同、数据处理协议和审计能力的企业服务。中转更适合个人学习、原型验证、非敏感自动化和能够随时切换供应商的任务。"],
  ["中转站的实际价格怎样计算？", "先确认充值换算，再看模型倍率、用户分组倍率、渠道倍率以及输入、输出、缓存读写的单独价格。简化公式是：实际人民币成本约等于官方美元单价乘 Token 用量，再乘各项倍率并除以充值兑换比例。只比较首页写的“几折”通常不够，应该用一条真实账单复算。"],
  ["为什么缓存命中率会显著影响成本？", "Claude Code、Codex 和长对话会反复携带大量上下文。缓存命中时，重复上下文通常比重新输入便宜；切换上游账号、模型或路由可能让缓存失效。测试中应分别查看缓存写入、缓存读取和普通输入用量，不能只看总 Token。"],
  ["怎样判断模型是否真实、能力是否完整？", "不要只看模型名称。应测试模型版本标识、上下文长度、流式输出、工具调用、结构化输出、图片或文件输入，并用固定题目比较输出特征。若高价模型长期表现异常、关键能力缺失或账单模型名与请求不一致，应暂停充值并向客服核对。"],
  ["在线率高、平均延迟低就代表稳定吗？", "不一定。平均值可能掩盖晚高峰抖动、长请求中断和少量极慢请求。更有价值的指标包括成功率、P95 延迟、首字时间、完整响应时间、连续请求失败率和错误码分布。至少在白天与晚高峰各做一轮真实任务测试。"],
  ["使用中转站时如何保护隐私？", "默认假设中转服务理论上能够接触请求内容。不要发送密码、私钥、身份证件、未脱敏客户数据或完整生产数据库；敏感字段应在本地脱敏。企业使用前还应确认日志保留期限、数据存储地区、删除机制、上游渠道和是否提供数据处理协议。"],
  ["API Key 怎样管理才更安全？", "为不同项目创建独立 Key，设置额度、模型和 IP 限制，不要把 Key 写进前端代码、公开仓库、截图或聊天记录。服务端使用环境变量或密钥管理系统保存，并定期轮换。发现异常调用后应立即禁用旧 Key，而不是只修改应用配置。"],
  ["第一次应该充值多少？", "只充值完成验收测试和短期使用所需的金额。先确认到账换算、账单明细、退款条件和余额有效期，再逐步增加。大额赠送、超低包月和限时囤积可能把线路、调价或停运风险转移给用户，不应因为折扣一次性存入长期预算。"],
  ["退款、发票和客服应该怎么核实？", "查看公开规则是否写明可退款范围、手续费、处理时限、发票主体和开票内容，并在充值前保存规则页面。客服响应速度要用真实问题验证，尤其要观察故障时是否主动公告、是否解释错误原因，以及余额异常能否提供可核对的处理记录。"],
  ["为什么不建议盲目使用超长上下文？", "上下文越长，输入成本、等待时间和缓存失效代价越高，也不保证模型能同等关注全部内容。应先通过检索、摘要、分段和删除无关历史减少输入；只有任务确实需要并且完成成本测试后，再启用 200K 或更长上下文。"],
  ["中转站突然不可用时怎么办？", "提前保存 Base URL、模型映射和余额记录，并让应用支持通过配置切换供应商。关键业务至少准备一个备用 Key，设置请求超时、有限重试和熔断，避免无限重试造成重复扣费。故障发生后先停用自动任务，再根据错误码判断是余额、限流、模型下线还是整站故障。"],
  ["AI 中转站排行榜的数据和排名如何理解？", "榜单依据公开资料和监测快照整理，并采用本站独立、固定的区间排序规则。缺失字段不会按零计算，排名也不能替代你的本地测试。它适合用于建立候选名单，不构成稳定性承诺、资金安全保证或购买建议。"],
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
  return `<section class="method" id="method"><div class="shell"><div class="section-heading"><p>02 / SELECTION GUIDE</p><h2>如何选择 AI API 中转站</h2></div><div class="guide-intro"><p>不要从“哪家最便宜”开始，而要先确定任务、风险和退出方案。一个适合个人试用的中转站，不一定适合团队生产环境；一个短对话很快的接口，也不一定能稳定完成长代码任务。建议按下面的顺序筛选：明确需求、排除高风险候选、复算成本、完成真实验收，最后才决定充值额度。</p><strong>核心原则：能切换、能限额、能复算、能追责。</strong></div><div class="method-grid"><article><b>01 / 场景</b><h3>先确定是否应该用中转</h3><p>个人学习、原型和非敏感任务可以考虑中转。涉及客户数据、商业机密、医疗金融信息、正式 SLA 或长期生产服务时，应优先考虑官方 API 或能够签合同、提供审计与数据处理协议的企业服务。</p></article><article><b>02 / 模型</b><h3>核对目标模型与完整能力</h3><p>确认具体版本，而不是只看“支持 GPT、Claude”。逐项测试上下文长度、流式输出、工具调用、结构化 JSON、图片和文件输入。编程场景还要验证 Claude Code、Codex、Cursor 等工具所需的协议和缓存行为。</p></article><article><b>03 / 稳定</b><h3>看分布，不只看平均值</h3><p>至少记录成功率、首字时间、完整响应时间、P95 延迟和错误码。分别在白天、晚高峰进行连续短请求和长请求；如果短请求正常但长任务频繁中断，依然不适合编程代理或批处理。</p></article><article><b>04 / 计费</b><h3>用真实账单复算成本</h3><p>确认充值兑换比例、模型倍率、用户分组、输入输出单价以及缓存读写价格。完成一条可控请求后，将 Token 用量与官方价格逐项计算，核对最终扣费；首页折扣、余额美元符号和“1 元等于多少额度”都不能单独代表真实成本。</p></article><article><b>05 / 缓存</b><h3>测试长对话的缓存命中</h3><p>Claude Code、Codex 和长会话会反复发送上下文。检查账单是否区分普通输入、缓存写入和缓存读取，并连续运行相同项目观察命中率。上游切号或路由漂移可能使缓存失效，导致费用和等待时间突然上升。</p></article><article><b>06 / 隐私</b><h3>默认第三方可能接触内容</h3><p>不要发送密码、私钥、身份证件或未脱敏的生产数据。核实日志保存期限、存储地区、上游渠道和删除方式。为每个项目单独创建 Key，并配置额度、模型、IP 或并发限制，避免一个密钥泄露影响全部余额。</p></article><article><b>07 / 运营</b><h3>检查主体、规则和故障沟通</h3><p>查看运营时间、公告历史、客服入口、退款规则、发票主体和状态页。真正有价值的不是“永不跑路”的承诺，而是故障时能否及时公告、解释原因、给出恢复进度，并对异常扣费留下可核对的处理记录。</p></article><article><b>08 / 退出</b><h3>在充值前准备备用方案</h3><p>应用应把 Base URL、Key 和模型名放在配置中，避免写死。关键任务准备第二供应商，设置合理超时、有限重试和熔断。充值只覆盖近期用量，定期导出账单与余额截图，确保站点不可用时可以快速迁移。</p></article></div><div class="cost-guide"><div><p>COST CHECK / 费用复算</p><h3>不要只比较“倍率”</h3></div><div class="cost-formula"><code>实际成本 ≈ 官方单价 × Token 用量 × 模型倍率 × 分组倍率 ÷ 充值兑换比例</code><p>还要分别计算输入、输出、缓存写入、缓存读取，以及失败请求是否扣费。不同站点对“额度”“美元”和“倍率”的定义可能不同，最可靠的方法始终是复算一条真实账单。</p></div></div><div class="decision-table" role="table" aria-label="官方 API 与中转 API 选择对比"><div class="decision-row decision-row--head" role="row"><strong role="columnheader">判断维度</strong><strong role="columnheader">优先官方 API</strong><strong role="columnheader">可考虑中转 API</strong></div><div class="decision-row" role="row"><b role="rowheader">数据敏感度</b><span role="cell">客户数据、商业机密、合规数据</span><span role="cell">公开内容、学习与已脱敏数据</span></div><div class="decision-row" role="row"><b role="rowheader">服务要求</b><span role="cell">需要 SLA、合同、审计与长期稳定</span><span role="cell">允许短暂停机并能快速切换</span></div><div class="decision-row" role="row"><b role="rowheader">支付与接入</b><span role="cell">具备海外支付和官方账号条件</span><span role="cell">需要人民币支付、统一 Key 和兼容接口</span></div><div class="decision-row" role="row"><b role="rowheader">模型范围</b><span role="cell">长期使用单一厂商核心模型</span><span role="cell">需要低成本比较多个厂商和版本</span></div><div class="decision-row" role="row"><b role="rowheader">故障承受</b><span role="cell">无法接受第三方停运或上游切换</span><span role="cell">已有备用供应商、限额和迁移能力</span></div></div><section class="acceptance" aria-labelledby="acceptance-title"><div><p>30-MINUTE CHECK</p><h3 id="acceptance-title">充值前完成一次基础验收</h3><p>以下测试使用最低充值金额即可完成。最好保存请求时间、模型名、错误码、用量和扣费截图，方便比较不同候选站。</p></div><ol><li><b>创建隔离密钥</b><span>为测试单独创建 Key，设置小额上限，只开放目标模型；不要直接使用生产密钥。</span></li><li><b>确认协议兼容</b><span>用官方 SDK 或常用客户端完成一次非流式和流式请求，检查 Base URL、模型名和错误格式。</span></li><li><b>验证核心能力</b><span>测试工具调用、JSON 输出、图片或文件输入，以及任务所需的最大上下文，不要只发送一句“你好”。</span></li><li><b>连续请求二十次</b><span>混合短请求与长请求，记录成功率、首字时间、完整耗时、429、5xx 和中途断流。</span></li><li><b>晚高峰再测一次</b><span>同一测试在不同时段复跑，观察线路拥塞和账号池切换是否造成明显波动。</span></li><li><b>复算一条账单</b><span>核对输入、输出、缓存、倍率和最终扣费；检查失败或取消的请求是否收费。</span></li><li><b>测试限额与停用</b><span>确认额度限制是否生效，模拟 Key 泄露后的禁用和更换流程，验证旧 Key 立即失效。</span></li><li><b>联系一次客服</b><span>询问具体模型版本、退款边界或故障处理，用答案的清晰度和可验证性判断售后质量。</span></li></ol></section><aside class="red-flags"><div><p>RED FLAGS</p><h3>看到这些信号，应暂停充值</h3></div><ul><li>价格远低于常见成本，却无法解释上游、倍率或计费方式</li><li>只展示余额变化，不提供请求级 Token 和扣费明细</li><li>模型名称含糊，账单模型与请求模型不一致</li><li>频繁更换域名、收款主体、客服账号或充值方式</li><li>强调大额赠送、长期包月和限时囤积，但退款规则模糊</li><li>故障时删除讨论、长期无公告，或把所有问题归因于用户网络</li></ul></aside><p class="data-note">榜单快照更新于 ${dateText}。公开指标用于初筛，缺失字段不会按零值计算；正式使用前请按上述流程独立验证。</p></div></section><section class="faq shell" id="faq"><div class="section-heading"><p>03 / DETAILED FAQ</p><h2>AI 中转站常见问题</h2></div><p class="faq-lead">这里集中回答接入、价格、缓存、模型真实性、隐私、充值和故障迁移问题。不同站点规则会变化，涉及费用和数据处理时，应以当期公开规则及实际账单为准。</p><div class="faq-list">${faq}</div></section>`;
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
