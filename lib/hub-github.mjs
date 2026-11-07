const ISSUE_PATH = /^\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})\/issues\/([1-9]\d{0,15})\/?$/i;
const PULL_PATH = /^\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})\/pull\/([1-9]\d{0,15})\/?$/i;
const OWNER_REPO_PATH = /^\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})(?:\/[^?#]*)?$/i;
const GITHUB = 'https://github.com';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PRS = 4;
const TIMELINE_LIMIT = 40;
const COMMENTS_LIMIT = 20;
const CHECKS_LIMIT = 30;

function githubError(status, code, message) {
  return Object.assign(new Error(message), { status, code, expose: true });
}

function parsedWebUrl(value) {
  if (typeof value !== 'string' || value.length > 1200) return null;
  const trimmed = value.trim();
  if (!/^https:\/\/github\.com\//i.test(trimmed) || /[\\\s\x00-\x1f]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.origin === GITHUB && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function parseWorkUrl(value, pathPattern, kind) {
  const url = parsedWebUrl(value);
  const rawPath = url && value.trim().slice(GITHUB.length).split(/[?#]/, 1)[0];
  const match = rawPath && pathPattern.exec(rawPath);
  if (!match) return null;
  const [, owner, repo, rawNumber] = match;
  const number = Number(rawNumber);
  if (repo === '.' || repo === '..' || !Number.isSafeInteger(number)) return null;
  return { owner, repo, number, url: `${GITHUB}/${owner}/${repo}/${kind}/${number}`, key: `${owner}/${repo}/${number}`.toLowerCase() };
}

export const parseGitHubIssueUrl = value => parseWorkUrl(value, ISSUE_PATH, 'issues');
const parsePullUrl = value => parseWorkUrl(value, PULL_PATH, 'pull');

function sameRepoUrl(value, repository) {
  const url = parsedWebUrl(value);
  const match = url && OWNER_REPO_PATH.exec(url.pathname);
  return match && `${match[1]}/${match[2]}`.toLowerCase() === repository.toLowerCase() ? url.origin + url.pathname : '';
}

async function getJSON(path, token, signal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl('https://api.github.com' + path, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Zhiheng-Developer-Hub',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      redirect: 'error',
      signal
    });
  } catch {
    throw githubError(502, 'github_unreachable', 'GitHub 暂时无法连接，请稍后重试。');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const status = response.status;
    if (status === 429 || (status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      throw githubError(429, 'github_rate_limit', '已达到 GitHub 读取频率上限，请稍后重试。');
    }
    if (status === 404 || status === 410) {
      throw githubError(404, 'github_issue_unavailable', token
        ? '找不到这个 GitHub Issue，或当前连接无权读取。'
        : '找不到这个 GitHub Issue。读取私有仓库需要先配置 GitHub 连接。');
    }
    if (status === 401 || status === 403) {
      throw githubError(403, 'github_access_denied', 'GitHub 拒绝读取，请检查连接凭据和仓库权限。');
    }
    throw githubError(502, 'github_bad_response', 'GitHub 暂时无法提供 Issue 数据，请稍后重试。');
  }
  try {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new Error();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let json = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error();
      }
      json += decoder.decode(value, { stream: true });
    }
    return { data: JSON.parse(json + decoder.decode()), hasMore: /;\s*rel="next"/.test(response.headers.get('link') || '') };
  } catch {
    throw githubError(502, 'github_bad_response', 'GitHub 返回的数据无法读取，请稍后重试。');
  }
}

const repoPath = ({ owner, repo }) => `/repos/${owner}/${repo}`;
const trimmedText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
const lower = value => value.toLowerCase();
const normalized = value => value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
const trustedAssociation = value => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(value);

function contentLines(body) {
  let fenced = false;
  return body.split('\n').map(raw => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : raw;
  });
}

const fieldLine = /^([^:：]{1,25})[:：]\s*(.+)$/;
const headingLine = /^#{1,6}\s+(.+)$/;
const cleanLine = raw => raw.trim().replace(/^[-*]\s+/, '').replace(/\*\*/g, '');

function paragraphAfter(lines, index) {
  let start = index + 1;
  while (start < lines.length && !lines[start].trim()) start++;
  const values = [];
  for (let i = start; i < lines.length && lines[i].trim(); i++) {
    const line = cleanLine(lines[i]);
    if (headingLine.test(line) || fieldLine.test(line)) break;
    values.push(lines[i].trim());
  }
  return values.join('\n');
}

function fieldsIn(body) {
  const found = new Map();
  const lines = contentLines(body);
  for (const [index, raw] of lines.entries()) {
    const line = cleanLine(raw);
    const match = fieldLine.exec(line);
    const heading = headingLine.exec(line);
    const key = normalized((heading || match)?.[1] || '');
    if (!key || found.has(key)) continue;
    const value = heading ? paragraphAfter(lines, index) : match[2].trim();
    if (value) found.set(key, value);
  }
  return found;
}

const stages = new Map([
  ['待澄清', '待澄清'], ['待排期', '待排期'], ['待设计', '待设计'], ['设计中', '设计中'],
  ['待开发', '待开发'], ['开发中', '开发中'], ['进行中', '进行中'], ['in progress', '进行中'],
  ['待评审', '待评审'], ['in review', '待评审'], ['待验收', '待验收'], ['待测试验收', '待验收'],
  ['待需求覆盖确认', '待需求覆盖确认'], ['待合并', '待合并'], ['待发布', '待发布'],
  ['已合并/待发布', '待发布'], ['已交付', '已交付'], ['已发布', '已发布'], ['已上线', '已上线']
]);
const deliveredStages = new Set(['已交付', '已发布', '已上线']);
const advancingStages = new Set(['设计中', '开发中', '进行中', '待评审', '待验收', '待需求覆盖确认', '待合并', '待发布']);
const negative = /^(?:无|暂无|没有|无阻塞|未阻塞|不适用|无已知阻塞|none|n\/a|no|[-—])(?:[。.]|\s*)$/i;
const placeholder = /^(?:待填写|待补充|未填写|未分派|未指定|tbd|todo|[-—])$/i;
const stageFromLabel = label => {
  const value = normalized(label).replace(/^(?:status|stage|状态|阶段)\s*[:：]\s*/, '');
  return stages.get(value);
};

function issueFacts({ body, labels, state, stateReason, assignees, evidence }, viewerLogin, trustedBody) {
  const fields = fieldsIn(body);
  const field = (...keys) => {
    const match = keys.map(key => fields.get(key)).find(value => value && !placeholder.test(value));
    return match ? match.slice(0, 400) : '';
  };
  const rawStage = field('当前阶段', '阶段', 'stage', 'status', '状态');
  const proposedStage = stages.get(normalized(rawStage)) || rawStage;
  const issueStage = !trustedBody && deliveredStages.has(proposedStage) ? '' : proposedStage;
  const labelStage = labels.map(stageFromLabel).find(Boolean) || '';
  const blockedReason = field('阻塞', '阻塞原因', 'blocked by', 'blocker');
  const blockedLabel = labels.find(label => /^(?:blocked|阻塞|已阻塞)$/.test(normalized(label).replace(/^(?:status|状态)\s*[:：]\s*/, '')));
  const blocked = state === 'open' && Boolean(blockedLabel || (blockedReason && !negative.test(blockedReason)));
  const meLabel = labels.find(label => /^(?:待我处理|需要我处理)$/.test(normalized(label).replace(/^(?:status|状态)\s*[:：]\s*/, '')));
  const assignedToViewer = viewerLogin && assignees.map(lower).includes(lower(viewerLogin));
  const needsMe = state === 'open' && Boolean(assignedToViewer || meLabel);
  const stage = stages.get(normalized(issueStage)) || issueStage || labelStage;
  const recordedDelivery = evidence.delivery.length > 0;
  const isDelivered = recordedDelivery || deliveredStages.has(stage);
  const activePull = evidence.pullRequests.some(pr => ['open', 'draft'].includes(pr.state));
  const isInProgress = state === 'open' && !isDelivered && !blocked && (advancingStages.has(stage) || activePull);
  const closedLabel = stateReason === 'not_planned' ? '已关闭 · 不计划处理' : stateReason === 'duplicate' ? '已关闭 · 重复' : '已关闭';
  return {
    stage: stage || (recordedDelivery ? '已交付' : state === 'closed' ? closedLabel : activePull ? 'PR 推进中' : '待明确'),
    stageSource: issueStage ? 'Issue 正文' : labelStage ? 'Issue 标签' : recordedDelivery ? 'Issue 交付记录' : activePull && state === 'open' ? '关联 PR' : 'Issue 状态',
    priority: field('优先级', 'priority') || labels.find(label => /^(?:(?:priority|优先级)\s*[:：]\s*)?p[0-4]$/i.test(label)) || '',
    assignee: assignees.length ? assignees.map(login => '@' + login).join('、') : field('协调负责人', '负责人', 'assignee', 'owner'),
    nextStep: field('下一步', '下一步行动', 'next step'),
    blocked,
    blockedReason: blocked && !negative.test(blockedReason) ? blockedReason || blockedLabel || '' : '',
    needsMe,
    isInProgress,
    isDelivered
  };
}

function relatedIds(body) {
  const fields = fieldsIn(body);
  const read = (keys, format) => [...new Set(keys.flatMap(key => (fields.get(key) || '').toLowerCase()
    .split(/[，、,;；\s]+/)
    .map(value => value.replace(/^`(.*)`$/, '$1'))
    .filter(value => format.test(value))))].slice(0, 12);
  return {
    componentIds: read(['组件', '关联组件', 'component', 'components'], /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    agentIds: read(['agent', 'agents', '关联 agent', '关联agent'], /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/)
  };
}

function collectPulls(issue, timeline, sources) {
  const seen = new Map();
  const add = (raw, source, sourceUrl) => {
    const pr = parsePullUrl(raw);
    if (pr && !seen.has(pr.key)) seen.set(pr.key, { ...pr, source, sourceUrl });
  };
  for (const entry of [...timeline].reverse()) {
    if (['cross-referenced', 'connected'].includes(entry?.event)) {
      const source = entry.source?.issue;
      const reference = parsePullUrl(source?.pull_request?.html_url || source?.html_url);
      if (reference && trustedAssociation(source.author_association)
        && lower(reference.owner) === lower(issue.owner) && lower(reference.repo) === lower(issue.repo)) {
        add(reference.url, 'Issue 时间线', issue.url);
      }
    }
  }
  for (const { text, url, source } of sources) {
    const content = contentLines(text).join('\n');
    for (const match of content.matchAll(/https:\/\/github\.com\/[a-z\d-]+\/[a-z\d_.-]+\/pull\/[1-9]\d*(?![\w/])/gi)) add(match[0], source, url);
    for (const match of content.matchAll(/\b(?:PR|pull request)\s*#([1-9]\d*)\b/gi)) {
      add(`${GITHUB}/${issue.owner}/${issue.repo}/pull/${match[1]}`, source, url);
    }
  }
  return [...seen.values()];
}

function recordedEvidence(sources, kind) {
  const records = [];
  const isAcceptance = kind === 'acceptance';
  const fieldNames = isAcceptance
    ? /^(?:测试验收|独立验收|验收结果|验收结论|验收报告|验收与复核|acceptance(?: result| report)?)\s*[:：]\s*(.{1,400})$/i
    : /^(?:发布|交付|部署|上线|发布状态|部署状态|交付状态|release|deployment)\s*[:：]\s*((?:已交付|已发布|已部署|已上线|已合并并上线|deployed|released)(?:\b|[\s。！；，（(]|$).{0,400})$/i;
  const heading = isAcceptance
    ? /^#{1,6}\s+(?:独立验收|测试验收|验收结论|验收报告|验收记录|acceptance(?: report)?)(?:[\s（(：:]|$)/i
    : /^#{1,6}\s+(?:已交付|已发布|已上线|已部署|已合并并上线|已合并并发布)(?:[\s（(：:]|$)/;
  const document = isAcceptance ? /(?:^|\/)docs\/[\w./-]*acceptance[\w./-]*\.(?:md|pdf)(?=$|[^\w./-])/i : null;
  for (const { text, url, source, author } of sources) {
    const lines = contentLines(text);
    for (const [i, raw] of lines.entries()) {
      const line = cleanLine(raw);
      const name = headingLine.exec(line)?.[1];
      const paragraph = name ? paragraphAfter(lines, i) : '';
      const formLine = paragraph ? name + '：' + paragraph.replace(/\s+/g, ' ') : '';
      const match = fieldNames.exec(line) || fieldNames.exec(formLine);
      const artifact = document?.exec(line)?.[0].replace(/^\//, '') || '';
      if (!match && !heading.test(line) && !artifact) continue;
      const excerpt = heading.test(line) && paragraph ? `${name} · ${paragraph}` : match && formLine ? formLine : line;
      records.push({ text: excerpt.slice(0, 360), url, source, author });
      if (records.length === 6) return records;
    }
  }
  return records;
}

async function readChecks(pr, sha, get) {
  const root = `${repoPath(pr)}/commits/${sha}`;
  const [checks, combined] = await Promise.all([
    get(`${root}/check-runs?per_page=${CHECKS_LIMIT}`),
    get(`${root}/status?per_page=${CHECKS_LIMIT}`)
  ]);
  const runs = Array.isArray(checks?.data?.check_runs) ? checks.data.check_runs : null;
  const statuses = Array.isArray(combined?.data?.statuses) ? combined.data.statuses : null;
  const values = [
    ...(runs || []).slice(0, CHECKS_LIMIT).map(run => ({
      name: trimmedText(run?.name, 120), state: run?.status === 'completed' ? trimmedText(run?.conclusion, 24) || 'unknown' : 'pending',
      url: sameRepoUrl(run?.html_url || run?.details_url, `${pr.owner}/${pr.repo}`)
    })),
    ...(statuses || []).slice(0, CHECKS_LIMIT).map(status => ({
      name: trimmedText(status?.context, 120), state: trimmedText(status?.state, 24) || 'unknown',
      url: sameRepoUrl(status?.target_url, `${pr.owner}/${pr.repo}`)
    }))
  ].filter(item => item.name);
  const incomplete = !runs || !statuses || Boolean(checks?.hasMore || combined?.hasMore || checks?.data?.total_count > CHECKS_LIMIT);
  return { sha, url: `${GITHUB}/${pr.owner}/${pr.repo}/commit/${sha}`, values, incomplete };
}

async function readPull(pr, get) {
  const { owner, repo, number, url, source, sourceUrl } = pr;
  const result = { number, url, repository: `${owner}/${repo}`, source, sourceUrl };
  const data = (await get(`${repoPath(pr)}/pulls/${number}`))?.data;
  if (!data || data.number !== number || !['open', 'closed'].includes(data.state)) {
    return { ...result, title: '', state: 'unknown', checks: null };
  }
  const state = data.merged === true ? 'merged' : data.state === 'closed' ? 'closed' : data.draft ? 'draft' : 'open';
  const sha = /^[a-f\d]{40}$/i.test(data.head?.sha || '') ? data.head.sha : '';
  return {
    ...result, title: trimmedText(data.title, 260), state, mergedAt: iso(data.merged_at),
    checks: sha ? await readChecks(pr, sha, get) : null
  };
}

export async function readGitHubIssue(value, token, { includeEvidence = true, viewerLogin = '', fetchImpl = globalThis.fetch } = {}) {
  const issue = parseGitHubIssueUrl(value);
  if (!issue) throw githubError(400, 'invalid_github_issue_url', '请输入 https://github.com/所有者/仓库/issues/编号 格式的 Issue 链接。');
  const path = `${repoPath(issue)}/issues/${issue.number}`;
  const signal = AbortSignal.timeout(9000);
  const read = suffix => getJSON(suffix, token, signal, fetchImpl);
  const optional = suffix => read(suffix).catch(() => null);
  const { data } = await read(path);
  if (data?.pull_request) throw githubError(400, 'github_link_is_pull_request', '这个编号对应 Pull Request，请添加关联的 Issue 链接。');
  if (!data || data.number !== issue.number || !['open', 'closed'].includes(data.state) || typeof data.title !== 'string') {
    throw githubError(502, 'github_bad_response', 'GitHub 返回的 Issue 数据不完整，请稍后重试。');
  }
  const body = trimmedText(data.body, 30000);
  const trustedBody = trustedAssociation(data.author_association);
  const [timeline, comments] = includeEvidence ? await Promise.all([
    optional(`${path}/timeline?per_page=${TIMELINE_LIMIT}`),
    Number(data.comments) > 0 ? optional(`${path}/comments?per_page=${COMMENTS_LIMIT}`) : { data: [] }
  ]) : [null, null];
  const sources = trustedBody ? [{ text: body, url: issue.url, source: 'Issue 正文', author: trimmedText(data.user?.login, 64) }] : [];
  if (Array.isArray(comments?.data)) sources.push(...comments.data.slice(0, COMMENTS_LIMIT).flatMap(comment => {
    if (!Number.isSafeInteger(comment?.id) || comment.id <= 0 || !trustedAssociation(comment.author_association)) return [];
    return [{
      text: trimmedText(comment.body, 5000),
      url: `${issue.url}#issuecomment-${comment.id}`,
      source: 'Issue 评论',
      author: trimmedText(comment.user?.login, 64)
    }];
  }));
  const pullRefs = collectPulls(issue, Array.isArray(timeline?.data) ? timeline.data.slice(0, TIMELINE_LIMIT) : [], sources);
  const evidence = {
    pullRequests: includeEvidence ? await Promise.all(pullRefs.slice(0, MAX_PRS).map(pr => readPull(pr, optional))) : [],
    acceptance: recordedEvidence(sources, 'acceptance'),
    delivery: recordedEvidence(sources, 'delivery'),
    sourceAvailable: { timeline: Array.isArray(timeline?.data), comments: Array.isArray(comments?.data) },
    truncated: Boolean(timeline?.hasMore || comments?.hasMore || pullRefs.length > MAX_PRS || (typeof data.body === 'string' && data.body.length > body.length && data.body.trim().length > body.length))
  };
  const assignees = (Array.isArray(data.assignees) ? data.assignees : data.assignee ? [data.assignee] : [])
    .map(item => trimmedText(item?.login, 64)).filter(Boolean).slice(0, 30);
  const labels = (Array.isArray(data.labels) ? data.labels : [])
    .map(label => trimmedText(typeof label === 'string' ? label : label?.name, 100)).filter(Boolean).slice(0, 50);
  const result = {
    url: issue.url, repository: `${issue.owner}/${issue.repo}`, number: issue.number,
    title: trimmedText(data.title, 260), body, labels, assignees, state: data.state,
    stateReason: trimmedText(data.state_reason, 30), createdAt: iso(data.created_at), updatedAt: iso(data.updated_at),
    closedAt: iso(data.closed_at), syncedAt: new Date().toISOString(), evidence
  };
  return { ...result, ...issueFacts(result, trimmedText(viewerLogin, 64), trustedBody), ...relatedIds(trustedBody ? body : '') };
}
