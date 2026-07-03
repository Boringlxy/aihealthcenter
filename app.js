// ===== Global Error Handler =====
window.onerror = function (msg, url, line, col, error) {
  console.error('JS Error:', msg, 'line', line, error && error.stack);
  const ls = document.getElementById('loading-section');
  if (ls && !ls.classList.contains('hidden')) {
    ls.classList.add('hidden');
    const rs = document.getElementById('result-section');
    if (rs) {
      rs.classList.remove('hidden');
      rs.innerHTML = '<div class="card" style="color:var(--red);padding:2rem"><h3>运行出错了</h3><p>' + msg + '</p><pre style="font-size:.7rem;color:var(--text-3);white-space:pre-wrap">' + (error ? error.stack : '') + '</pre></div>';
    }
  }
  return true;
};

// ===== Shorthands =====
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const skillText = $('#skill-text');
const charCount = $('#char-count');
const btnDiagnose = $('#btn-diagnose');
const inputSection = $('#input-section');
const loadingSection = $('#loading-section');
const resultSection = $('#result-section');
const loadingBarFill = $('#loading-bar-fill');
const loadingStep = $('#loading-step');

let currentResult = null;
let skillFiles = [];   // { name, path, content } — readable text files
let fileMeta = [];     // { path, name, ext, category, isText, sizeBytes }
let scanData = null;   // summary of the scan

// ===== nnn-illustration availability check =====
let illustrationAvailable = false;
fetch('/api/status')
  .then(r => r.json())
  .then(d => { illustrationAvailable = !!d.illustrationAvailable; })
  .catch(() => { illustrationAvailable = false; });

// ===== Term Glossary (hover tooltips) =====
const GLOSSARY = {
  'SKILL.md': 'Skill 的“说明书首页”。AI 打开一个 Skill，最先读的就是这个文件。',
  '元数据': '写在 SKILL.md 最开头、用 --- 包起来的几行信息（名字、描述等），让 AI 一眼知道这个 Skill 是干嘛的。',
  'frontmatter': '同“元数据”：文件最开头 --- 之间的那段配置。',
  '触发': '让 AI 知道“用户说什么话的时候，该用这个 Skill”。',
  '脚本': '能直接运行出结果的代码文件（如 .py / .sh），比让 AI 用文字猜更稳。',
  '铁律': '放在最前面、用 ⚠️ 标注的强制规则，AI 会优先遵守。',
  'MCP': '一种让 AI 调用外部工具/服务的标准接口。',
  '视觉校验': '把结果渲染成图片，让 AI 看着图检查有没有排版错位等问题，有问题就改。',
  '反馈闭环': '做完→检查→有错就回去改→再检查，直到通过才交付的循环。',
  '第三人称': '客观陈述“它做什么”，别用“我/你”开头（如“提取 PDF 文本”而非“我帮你处理 PDF”）。',
  '反模式': '公认不该犯的写法，比如反斜杠路径、甩一堆选项不给默认、写会过期的时间信息。',
};
function wrapTerms(str) {
  if (!str) return '';
  let out = str;
  Object.keys(GLOSSARY).forEach(term => {
    // escape for regex
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + safe + ')(?![^<]*>)', 'g');
    out = out.replace(re, '<span class="term" data-tip="' + GLOSSARY[term] + '">$1</span>');
  });
  return out;
}

// ===== Tabs =====
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ===== Textarea =====
skillText.addEventListener('input', () => {
  charCount.textContent = skillText.value.length;
  btnDiagnose.disabled = !skillText.value.trim();
  if (skillText.value.trim() && (!skillFiles.length)) {
    // pasted single content — treat as one SKILL.md
    skillFiles = [{ name: 'SKILL.md', path: 'SKILL.md', content: skillText.value }];
    fileMeta = [{ path: 'SKILL.md', name: 'SKILL.md', ext: '.md', category: 'docs', isText: true, sizeBytes: skillText.value.length }];
  }
});

// ===== File classification =====
const EXT_CATEGORY = {
  docs: ['.md', '.markdown', '.txt', '.rst'],
  scripts: ['.py', '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rb', '.go', '.rs', '.php', '.java', '.sql', '.pl'],
  config: ['.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf', '.env'],
  resources: ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.mp4', '.mp3', '.wav', '.pdf', '.ttf', '.woff', '.woff2', '.eot', '.csv', '.xlsx', '.xls', '.doc', '.docx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.db', '.sqlite'],
};
const CAT_META = {
  docs: { label: '文档', icon: '📄' },
  scripts: { label: '脚本', icon: '⚙️' },
  config: { label: '配置', icon: '🔧' },
  resources: { label: '资源', icon: '🎨' },
  other: { label: '其他', icon: '📦' },
};
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}
function classify(ext) {
  for (const cat of Object.keys(EXT_CATEGORY)) {
    if (EXT_CATEGORY[cat].includes(ext)) return cat;
  }
  return 'other';
}
const TEXT_CATS = new Set(['docs', 'scripts', 'config']);

function shouldSkipDir(path) {
  const segs = path.toLowerCase().split('/');
  const skip = ['node_modules', '.git', '__pycache__', '.ds_store', 'dist', 'build', 'coverage', 'vendor', '.idea', '.vscode'];
  return segs.some(s => skip.includes(s));
}

// ===== File Upload =====
const dropZone = $('#drop-zone');
const fileInfo = $('#file-info');
const btnSelectFolder = $('#btn-select-folder');
const btnSelectZip = $('#btn-select-zip');

dropZone.addEventListener('click', () => openFolderPicker());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleDroppedFiles(e.dataTransfer.files);
});
btnSelectFolder.addEventListener('click', () => openFolderPicker());
btnSelectZip.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,.tar,.gz,.tgz';
  input.addEventListener('change', e => { if (e.target.files.length) handleFileList(e.target.files); });
  input.click();
});
function openFolderPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;
  input.addEventListener('change', e => handleFileList(e.target.files));
  input.click();
}

async function handleDroppedFiles(fileList) {
  if (fileList.length === 1 && fileList[0].name.toLowerCase().endsWith('.zip')) {
    await handleZipFile(fileList[0]);
  } else {
    await handleFileList(fileList);
  }
}

async function handleFileList(fileList) {
  if (fileList.length === 1 && fileList[0].name.toLowerCase().endsWith('.zip')) {
    return handleZipFile(fileList[0]);
  }

  skillFiles = [];
  fileMeta = [];

  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    if (shouldSkipDir(path)) continue;
    const name = path.split('/').pop();
    const ext = extOf(name);
    const category = classify(ext);
    const isText = TEXT_CATS.has(category);
    const meta = { path, name, ext, category, isText, sizeBytes: file.size };
    fileMeta.push(meta);
    if (isText) {
      try {
        const content = await readFileAsText(file);
        if (content != null) skillFiles.push({ name, path, content });
      } catch (e) { /* skip */ }
    }
  }
  finalizeScan(fileList.length);
}

async function handleZipFile(file) {
  if (typeof JSZip === 'undefined') {
    showError('JSZip 未加载，请刷新页面重试');
    return;
  }
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const zip = await JSZip.loadAsync(buffer);
    skillFiles = [];
    fileMeta = [];
    const entries = [];
    zip.forEach((relativePath, entry) => {
      if (!entry.dir && !shouldSkipDir(relativePath)) entries.push({ path: relativePath, entry });
    });
    for (const { path, entry } of entries) {
      const name = path.split('/').pop();
      const ext = extOf(name);
      const category = classify(ext);
      const isText = TEXT_CATS.has(category);
      const meta = { path, name, ext, category, isText, sizeBytes: 0 };
      fileMeta.push(meta);
      if (isText) {
        try {
          const content = await entry.async('string');
          meta.sizeBytes = content.length;
          if (content != null) skillFiles.push({ name, path, content });
        } catch (e) { /* skip */ }
      }
    }
    finalizeScan(entries.length);
  } catch (e) {
    showError('解压失败: ' + e.message);
  }
}

function showError(text) {
  fileInfo.classList.remove('hidden');
  fileInfo.innerHTML = '<div class="scan-error">' + text + '</div>';
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsText(file);
  });
}
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsArrayBuffer(file);
  });
}

function finalizeScan(totalScanned) {
  if (fileMeta.length === 0) {
    showError('没找到可分析的文件');
    btnDiagnose.disabled = true;
    return;
  }
  // Build scan summary
  const categories = { docs: [], scripts: [], config: [], resources: [], other: [] };
  fileMeta.forEach(m => categories[m.category].push(m));
  let totalLines = 0;
  skillFiles.forEach(f => { totalLines += f.content.split('\n').length; });

  // skill name guess
  const skillMd = skillFiles.find(f => f.name.toUpperCase() === 'SKILL.MD');
  let skillName = '';
  if (skillMd) {
    const m = skillMd.content.match(/^name\s*[:：]\s*(.+)$/im);
    if (m) skillName = m[1].trim().replace(/['"]/g, '');
  }
  if (!skillName) {
    const root = fileMeta[0].path.split('/')[0];
    skillName = (fileMeta.length > 1 && fileMeta.every(m => m.path.split('/')[0] === root)) ? root : (skillMd ? 'SKILL.md' : '未命名 Skill');
  }

  scanData = {
    totalFiles: fileMeta.length,
    textFiles: skillFiles.length,
    totalLines,
    categories,
    tree: buildTree(fileMeta.map(m => m.path)),
    skillName,
  };

  // populate textarea (for analysis + visibility) silently
  skillText.value = buildCombinedText(skillFiles);
  charCount.textContent = skillText.value.length;
  btnDiagnose.disabled = skillFiles.length === 0;

  renderScanSummary(totalScanned);
}

function renderScanSummary(totalScanned) {
  fileInfo.classList.remove('hidden');
  const cats = scanData.categories;
  const chips = Object.keys(CAT_META).filter(c => cats[c].length).map(c =>
    '<span class="cat-chip cat-' + c + '">' + CAT_META[c].icon + ' ' + CAT_META[c].label + ' <b>' + cats[c].length + '</b></span>'
  ).join('');
  fileInfo.innerHTML =
    '<div class="scan-head">已识别 <b>' + scanData.skillName + '</b> · 共 <b>' + scanData.totalFiles + '</b> 个文件（可读文本 ' + scanData.textFiles + '）</div>' +
    '<div class="cat-chips">' + chips + '</div>';
}

function buildCombinedText(files) {
  const sorted = [...files].sort((a, b) => priority(b.path) - priority(a.path));
  return sorted.map(f => '='.repeat(48) + '\n📄 ' + f.path + '\n' + '='.repeat(48) + '\n' + f.content).join('\n\n');
}
function priority(path) {
  const name = path.split('/').pop().toUpperCase();
  if (name === 'SKILL.MD') return 100;
  if (name === 'README.MD') return 80;
  if (name === 'PLUGIN.JSON' || name === 'PACKAGE.JSON') return 70;
  if (/\.(PY|SH|JS|TS)$/.test(name)) return 60;
  if (name.endsWith('.MD')) return 50;
  return 10;
}

// ===== File Tree =====
function buildTree(paths) {
  const root = {};
  paths.forEach(p => {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      if (!node[part]) node[part] = isFile ? null : {};
      if (!isFile) node = node[part];
    });
  });
  return root;
}
function renderTree(node, depth) {
  depth = depth || 0;
  const keys = Object.keys(node).sort((a, b) => {
    const af = node[a] === null, bf = node[b] === null;
    if (af !== bf) return af ? 1 : -1; // folders first
    return a.localeCompare(b);
  });
  let html = '';
  keys.forEach(k => {
    const isFile = node[k] === null;
    const pad = depth * 16;
    const ext = isFile ? extOf(k) : '';
    const cat = isFile ? classify(ext) : null;
    const icon = isFile ? CAT_META[cat].icon : '📁';
    const cls = isFile ? 'tree-file cat-' + cat : 'tree-folder';
    html += '<div class="tree-row ' + cls + '" style="padding-left:' + pad + 'px">' +
      '<span class="tree-icon">' + icon + '</span>' +
      '<span class="tree-name">' + k + (isFile ? '' : '/') + '</span></div>';
    if (!isFile) html += renderTree(node[k], depth + 1);
  });
  return html;
}

// ===== Remove file =====
$('#file-remove') && $('#file-remove').addEventListener('click', resetInput);
function resetInput() {
  fileInfo.classList.add('hidden');
  fileInfo.innerHTML = '';
  skillFiles = [];
  fileMeta = [];
  scanData = null;
  skillText.value = '';
  charCount.textContent = '0';
  btnDiagnose.disabled = true;
}

// ===== Diagnose flow =====
btnDiagnose.addEventListener('click', startDiagnosis);

async function startDiagnosis() {
  // ensure paste mode has scan data
  if (!scanData && skillText.value.trim()) {
    skillFiles = [{ name: 'SKILL.md', path: 'SKILL.md', content: skillText.value }];
    fileMeta = [{ path: 'SKILL.md', name: 'SKILL.md', ext: '.md', category: 'docs', isText: true, sizeBytes: skillText.value.length }];
    finalizeScan(1);
  }

  inputSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');
  resultSection.classList.add('hidden');

  const steps = [
    '展开文件结构…',
    '检查骨架是否齐全…',
    '看 AI 能不能找到它…',
    '判断能不能干实事…',
    '排查安全风险…',
    '评估好不好读好维护…',
    '对照最佳实践看写得地不地道…',
    '生成体检报告…',
  ];
  for (let i = 0; i < steps.length; i++) {
    loadingStep.textContent = steps[i];
    loadingBarFill.style.width = ((i + 1) / steps.length * 100) + '%';
    await sleep(260 + Math.random() * 180);
  }

  let result;
  try {
    result = analyzeSkill();
    currentResult = result;
  } catch (e) {
    console.error('analyze error', e);
    loadingSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    resultSection.innerHTML = '<div class="card" style="padding:2rem;color:var(--red)"><h3>诊断出错</h3><p>' + e.message + '</p></div>';
    return;
  }

  // If nnn illustration is available, keep loading screen until image is ready
  if (illustrationAvailable) {
    loadingStep.textContent = '正在生成报告一览图，预计 30~60 秒…';
    const countdownStart = Date.now();
    const estimatedSec = 50;
    const countdownTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - countdownStart) / 1000);
      const remaining = Math.max(0, estimatedSec - elapsed);
      loadingStep.textContent = '正在生成报告一览图，预计还需 ' + remaining + ' 秒…';
      loadingBarFill.style.width = Math.min(98, 85 + (elapsed / estimatedSec) * 13) + '%';
    }, 1000);

    // Render results in a hidden state first so DOM gets populated
    resultSection.style.visibility = 'hidden';
    resultSection.style.position = 'absolute';
    resultSection.classList.remove('hidden');
    renderResult(result);

    // Wait for illustration to appear or fail, then show everything
    const waitForIllustration = () => {
      return new Promise(resolve => {
        const check = () => {
          const illo = document.querySelector('.nnn-illustration');
          const fallback = document.querySelector('.illustration-area img');
          if (illo || fallback) { resolve(); return; }
          setTimeout(check, 500);
        };
        setTimeout(() => { resolve(); }, 120000);
        check();
      });
    };
    await waitForIllustration();
    clearInterval(countdownTimer);
    loadingBarFill.style.width = '100%';
    loadingStep.textContent = '报告一览图生成完成！';
    await sleep(400);

    // Now reveal results and hide loading
    resultSection.style.visibility = '';
    resultSection.style.position = '';
    loadingSection.classList.add('hidden');
  } else {
    loadingSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    renderResult(result);
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== The 5 Dimensions =====
const DIMENSIONS = [
  { key: 'structure', name: '骨架齐全', icon: '🦴', weight: 0.17, oneLine: '该有的文件在不在、结构清不清楚' },
  { key: 'findable', name: '能被找到', icon: '🔍', weight: 0.17, oneLine: 'AI 在对的时候会不会想起用它' },
  { key: 'doable', name: '能干实事', icon: '🔧', weight: 0.17, oneLine: '靠脚本工具，还是靠 AI 瞎猜' },
  { key: 'safe', name: '安全可控', icon: '🛡️', weight: 0.17, oneLine: '危险操作前会不会先问一句' },
  { key: 'readable', name: '好读好维护', icon: '📖', weight: 0.17, oneLine: '新人看不看得懂、改起来累不累' },
  { key: 'quality', name: '写得地道', icon: '✨', weight: 0.15, oneLine: '有没有按最佳实践打磨、够不够专业' },
];

// ===== Analysis Engine =====
function analyzeSkill() {
  const text = skillText.value;
  const paths = fileMeta.map(m => m.path);
  const scripts = scanData.categories.scripts;
  const skillMd = skillFiles.find(f => f.name.toUpperCase() === 'SKILL.MD');
  const skillMdContent = skillMd ? skillMd.content : (skillFiles[0] ? skillFiles[0].content : text);
  const skillMdLines = skillMdContent ? skillMdContent.split('\n').length : 0;

  const scores = {};
  const problems = [];
  const evidence = {}; // per-dim plain-language evidence

  // ---------- shared signals ----------
  const hasSkillMd = !!skillMd || /SKILL\.md/i.test(text);
  const frontmatter = (skillMdContent.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/m) || [])[1] || '';
  const hasFrontmatter = !!frontmatter;
  const hasName = /^\s*name\s*[:：]/im.test(frontmatter) || /^\s*name\s*[:：]/im.test(text.slice(0, 600));
  const hasDesc = /description\s*[:：]\s*\S/i.test(text);
  const hasSubdirs = paths.some(p => p.includes('/') && p.split('/').length > 1 && /scripts|references|assets|docs|examples|templates|prompts|agents|skills/i.test(p));
  const refSplit = paths.filter(p => /\.md$/i.test(p)).length > 1; // content split across md files
  const multiFile = scanData.totalFiles > 1;

  const hasTriggers = /触发|什么时候用|何时使用|使用场景|适用场景|when to use|当用户|用户说|关键词/i.test(text);
  const hasBoundary = /仅做|只做|不做|不负责|不提供|请用|请改用|交给|超出.{0,6}范围/i.test(text);

  const hasStructuredSteps = (text.match(/(?:^|\n)\s*(?:Step\s*\d|步骤\s*\d|第[一二三四五六]步|\d+[\.\)、])/gim) || []).length >= 2;
  const hasCode = scripts.length > 0;
  const hasMCP = /\bMCP\b|Model\s+Context\s+Protocol/i.test(text);
  const hasCommands = /```(?:bash|sh|shell|python|js|console)?[\s\S]*?```/.test(text) || /\$\s+\w+|python3?\s+\w+|node\s+\w+|\.\/\w+\.(py|sh)/.test(text);
  const hasTests = paths.some(p => /(^|[\/_\-])(test|spec)([\/_\-]|s\b)/i.test(p));

  const RISKY = /(创建|新建|删除|移除|发送|提交|写入|更新|修改|批量|付款|支付|转账|授权|权限|部署|发布|覆盖|清空|drop\s+table|rm\s+-rf)/i;
  const hasRisky = RISKY.test(text);
  const hasConfirm = /请确认|确认后|确认再|二次确认|需要.{0,4}确认|是否继续|让用户确认|💡\s*确认/i.test(text);
  const hasIronRule = /⚠️/.test(text) && /(必须|禁止|不得|严禁)/.test(text);

  const hasVersion = /version\s*[:：]\s*\S|v\d+\.\d+(\.\d+)?/i.test(text);
  const hasChangelog = /更新日志|变更记录|changelog|更新记录|版本历史/i.test(text);
  const hasAuthor = /author\s*[:：]|作者\s*[:：]|负责人|花名|工号|owner\s*[:：]/i.test(text);

  // ---------- 1. 骨架齐全 (structure) ----------
  let structure;
  if (!hasSkillMd) {
    structure = 1.5;
  } else if (!hasFrontmatter) {
    structure = 3;
  } else if (hasFrontmatter && (hasSubdirs || refSplit)) {
    structure = 5;
  } else if (hasFrontmatter) {
    structure = 4;
  } else {
    structure = 2.5;
  }
  if (structure >= 4 && !multiFile && !hasSubdirs && skillMdLines > 250) structure = Math.max(3.5, structure - 0.5);
  evidence.structure = !hasSkillMd
    ? '没找到 SKILL.md 这个“说明书首页”'
    : !hasFrontmatter ? '有 SKILL.md，但开头缺少元数据'
    : (hasSubdirs || refSplit) ? '有 SKILL.md + 元数据，文件分门别类放好了'
    : 'SKILL.md 和元数据都有，所有内容都在一个文件里';

  if (!hasSkillMd) {
    problems.push({
      dim: 'structure', severity: 'high', effort: 'medium',
      title: '没有 SKILL.md 这个“说明书首页”',
      why: 'AI 拿到一个 Skill，第一件事就是翻开 SKILL.md 看“这是干嘛的、怎么用”。没有它，AI 等于拿到一本没有封面也没有目录的书，根本不知道从哪看起。',
      how: '在文件夹根目录建一个 SKILL.md，把这个 Skill 的名字、用途、用法写进去。',
      example: '# 我的排课助手\n\n帮学生安排每周课程表。'
    });
  } else if (!hasFrontmatter) {
    problems.push({
      dim: 'structure', severity: 'medium', effort: 'easy',
      title: 'SKILL.md 开头缺少元数据',
      why: '元数据是文件最开头那几行“身份证信息”。AI 靠它快速判断要不要用这个 Skill，不用把整篇读完。',
      how: '在 SKILL.md 最顶部加一段用 --- 包起来的内容，至少写上名字和一句话描述。',
      example: '---\nname: 排课助手\ndescription: 帮学生排每周课表\n---'
    });
  } else if (!hasSubdirs && !refSplit && skillMdLines > 250) {
    problems.push({
      dim: 'structure', severity: 'low', effort: 'medium',
      title: '所有内容都堆在一个文件里',
      why: '东西多了还全塞在一页里，AI 和人都得翻很久才能找到重点，改起来也容易碰乱。',
      how: '把脚本放进 scripts/ 文件夹，把详细资料放进 references/ 文件夹，SKILL.md 只留主干和链接。'
    });
  }
  scores.structure = clamp(structure);

  // ---------- 2. 能被找到 (findable) ----------
  let findable;
  if (!hasFrontmatter && !hasDesc) {
    findable = 1.5;
  } else if (hasDesc && hasTriggers && hasBoundary) {
    findable = 5;
  } else if (hasDesc && hasTriggers) {
    findable = 4;
  } else if (hasDesc) {
    findable = 3;
  } else {
    findable = 2;
  }
  evidence.findable = !hasDesc ? '没写清这个 Skill 是干嘛的'
    : (hasTriggers && hasBoundary) ? '说清了用途、什么时候触发、不做什么'
    : hasTriggers ? '有用途和触发时机，但没说清边界'
    : '有用途说明，但没说“什么时候该用我”';

  if (!hasDesc) {
    problems.push({
      dim: 'findable', severity: 'high', effort: 'easy',
      title: '没写清“这个 Skill 是干嘛的”',
      why: 'AI 面对一堆 Skill，靠的就是这句描述来挑出该用哪个。描述缺失，AI 很可能直接忽略你的 Skill。',
      how: '在元数据里加一行 description，用一句话说清做什么。',
      example: 'description: 帮学生安排每周课程表'
    });
  } else if (!hasTriggers) {
    problems.push({
      dim: 'findable', severity: 'medium', effort: 'easy',
      title: '没说“用户说什么话时该用它”',
      why: '光说“我能排课”还不够，要告诉 AI 用户说哪些话时算是要用你，AI 才能在对的时刻想起你。',
      how: '在描述或正文里列几个触发说法/场景。',
      example: '当用户说“帮我排课”“安排一下学习时间”时使用'
    });
  } else if (!hasBoundary) {
    problems.push({
      dim: 'findable', severity: 'low', effort: 'easy',
      title: '没说清“什么不归我管”',
      why: '说清边界能避免 AI 在不合适的场景误用你，也方便它把活转给更合适的 Skill。',
      how: '加一句“仅做 X；Y 请用 [另一个 Skill]”。',
      example: '仅做排课；选课推荐请用 course-search'
    });
  }
  scores.findable = clamp(findable);

  // ---------- 3. 能干实事 (doable) ----------
  let doable;
  if (hasCode && (hasTests || hasCommands)) {
    doable = 5;
  } else if (hasCode || hasMCP) {
    doable = 4;
  } else if (hasStructuredSteps) {
    doable = 3;
  } else {
    doable = 1.8;
  }
  evidence.doable = (hasCode && (hasTests || hasCommands)) ? '有可运行脚本，还写了怎么调用'
    : hasCode ? '有可运行脚本'
    : hasMCP ? '靠外部工具（MCP）来干活'
    : hasStructuredSteps ? '有清晰的分步骤说明，但没有脚本'
    : '全靠文字描述，让 AI 自己理解发挥';

  if (!hasCode && !hasMCP) {
    problems.push({
      dim: 'doable', severity: hasStructuredSteps ? 'medium' : 'high', effort: 'medium',
      title: hasStructuredSteps ? '只有文字步骤，缺一个能直接跑的脚本' : '全靠 AI 读文字自己发挥',
      why: '同一段文字，AI 每次理解可能略有出入，结果就不稳定。一个能直接运行的脚本，每次都给出一样的结果，省心又可靠。',
      how: '把最核心的那一步写成 scripts/ 下的一个小脚本，让 AI 去运行它，而不是自己猜。',
      example: 'scripts/make_schedule.py —— 输入课程清单，输出排好的课表'
    });
  } else if (hasCode && !hasTests && !hasCommands) {
    problems.push({
      dim: 'doable', severity: 'low', effort: 'easy',
      title: '有脚本，但没说怎么运行',
      why: 'AI 看到脚本却不知道怎么调、传什么参数，可能就放着不用了。',
      how: '在 SKILL.md 里写一行示例命令，告诉 AI 怎么跑这个脚本。',
      example: '运行：python3 scripts/make_schedule.py 课程清单.json'
    });
  }
  scores.doable = clamp(doable);

  // ---------- 4. 安全可控 (safe) ----------
  let safe;
  if (!hasRisky) {
    safe = hasConfirm ? 5 : 4; // no risky ops = inherently low risk
  } else if (hasRisky && hasIronRule && hasConfirm) {
    safe = 5;
  } else if (hasRisky && hasConfirm) {
    safe = 4;
  } else if (hasRisky) {
    safe = 2;
  } else {
    safe = 3.5;
  }
  evidence.safe = !hasRisky ? '没有危险操作，本身就比较安全'
    : (hasIronRule && hasConfirm) ? '危险操作前会确认，还有强制铁律兜底'
    : hasConfirm ? '危险操作前会让用户确认'
    : '有创建/删除/发送这类危险操作，但没看到确认步骤';

  if (hasRisky && !hasConfirm) {
    problems.push({
      dim: 'safe', severity: 'high', effort: 'easy',
      title: '危险操作前没有“先问一句”',
      why: '创建日程、发消息、删数据这类操作一旦做错很难挽回。让 AI 在动手前先问用户一句，能挡掉绝大多数误操作。',
      how: '在这类操作前加一步确认提示，等用户点头再执行。',
      example: '💡 即将创建 3 个日历事件，确认继续吗？'
    });
  } else if (hasRisky && !hasIronRule) {
    problems.push({
      dim: 'safe', severity: 'low', effort: 'easy',
      title: '可以加一条“铁律”再保险一点',
      why: 'AI 偶尔会跳过长篇说明。把最重要的安全规则用 ⚠️ 放在最前面、写成“必须/禁止”，AI 会优先遵守。',
      how: '在 SKILL.md 顶部加一行铁律。',
      example: '⚠️ 未经用户确认，禁止发送或删除任何内容'
    });
  }
  scores.safe = clamp(safe);

  // ---------- 5. 好读好维护 (readable) ----------
  let readable;
  const lengthOK = skillMdLines > 0 && skillMdLines <= 200;
  const lengthFair = skillMdLines > 0 && skillMdLines <= 500;
  if (skillMdLines === 0) {
    readable = 2;
  } else if (lengthOK && hasVersion && (hasChangelog || hasAuthor)) {
    readable = 5;
  } else if (lengthFair && hasVersion) {
    readable = 4;
  } else if (lengthFair) {
    readable = 3.2;
  } else if (skillMdLines <= 800) {
    readable = 2.5;
  } else {
    readable = 1.8;
  }
  if (refSplit && readable < 5) readable += 0.3;
  evidence.readable = skillMdLines === 0 ? '没有主文件可读'
    : skillMdLines > 500 ? 'SKILL.md 偏长（' + skillMdLines + ' 行），读起来累'
    : (hasVersion && (hasChangelog || hasAuthor)) ? skillMdLines + ' 行，简洁，有版本和维护信息'
    : skillMdLines + ' 行，长度合适';

  if (skillMdLines > 500) {
    problems.push({
      dim: 'readable', severity: skillMdLines > 800 ? 'medium' : 'low', effort: 'medium',
      title: 'SKILL.md 太长了（' + skillMdLines + ' 行）',
      why: '文件越长，AI 越容易抓不住重点、漏看关键规则，人改起来也头疼。理想是 200 行以内。',
      how: '把详细资料拆到单独的 .md 文件，SKILL.md 只留主干和“详见 xxx.md”的链接。'
    });
  }
  if (!hasVersion) {
    problems.push({
      dim: 'readable', severity: 'low', effort: 'easy',
      title: '没有版本号',
      why: '有了版本号，别人一眼就知道用的是哪一版，出问题也好对照。',
      how: '在元数据里加 version。',
      example: 'version: 1.0.0'
    });
  }
  if (!hasAuthor) {
    problems.push({
      dim: 'readable', severity: 'low', effort: 'easy',
      title: '没写是谁做的',
      why: '别人想改你的 Skill 或遇到问题时，能知道找谁。',
      how: '在元数据或末尾留个作者/联系方式。',
      example: 'author: 小流（工号 12345）'
    });
  }
  scores.readable = clamp(readable);

  // ---------- 6. 写得地道 (quality / 符合最佳实践) ----------
  // 基线只看“有没有”，这一维度看“写得好不好”。逐条对应 Anthropic Skill 最佳实践，
  // 全部从文本启发式判断；不适用的检查项不参与打分，避免误伤简单 Skill。
  const descMatch = text.match(/description\s*[:：]\s*(.+)/i);
  const descVal = descMatch ? descMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';

  const visualExts = /\.(pdf|png|jpe?g|svg|pptx?|docx?|xlsx?|html?)$/i;
  const hasVisualFiles = paths.some(p => visualExts.test(p));
  const mentionsVisualFmt = /幻灯片|PPT|图表|图形|海报|封面|网页|页面|渲染|排版|diagram|excalidraw|canvas|slide|chart|html|svg|图片|配图/i.test(text);
  const handlesVisual = hasVisualFiles || mentionsVisualFmt;
  const mentionsVisualCheck = /渲染[^。\n]{0,8}(看|检查|校验|核对)|截图|预览[^。\n]{0,6}(看|检查|核对)?|转成?图片?|看一眼|肉眼|visual\s*(qa|check|analysis)|playwright|render[^.\n]{0,20}(check|review|verify)|自检|目视/i.test(text);

  const hasFeedbackLoop = /校验|验证|verify|检查后再|检查无误|失败则|失败就|重复直到|再次检查|回到第|循环直到|validate|run.{0,10}fix.{0,10}repeat|跑一遍.{0,6}(检查|确认)/i.test(text);

  const mdFiles = skillFiles.filter(f => /\.md$/i.test(f.name));
  const nestedRefs = mdFiles.some(f => f.name.toUpperCase() !== 'SKILL.MD' && /\]\([^)]+\.md\)/i.test(f.content));

  const manyOptions = text.split('\n').some(ln =>
    (ln.match(/或/g) || []).length >= 2 || (ln.match(/\bor\b/gi) || []).length >= 2
  );
  const mentionsToolChoice = /库|工具|library|tool|package|方案|用哪个|选择/i.test(text);

  const scriptPaths = new Set(scripts.map(m => m.path));
  const scriptContents = skillFiles.filter(f => scriptPaths.has(f.path)).map(f => f.content);
  let hasVoodoo = false;
  scriptContents.forEach(c => {
    const lines = c.split('\n');
    lines.forEach((ln, i) => {
      if (/^\s*[A-Z][A-Z0-9_]{2,}\s*=\s*-?\d+(\.\d+)?\s*$/.test(ln)) {
        const prev = lines[i - 1] || '';
        if (!/#|\/\//.test(ln) && !/#|\/\//.test(prev)) hasVoodoo = true;
      }
    });
  });

  const winPath = /[\w.\-]+\\[\w.\-]+\.(py|sh|js|ts|md|json|txt|ya?ml|csv)/i.test(text);
  const timeSensitive = /20\d{2}\s*年[^。\n]{0,20}(之前|之后|以前|以后|前用|后用)/.test(text) ||
    /(before|after)\s+\w+\s+20\d{2}/i.test(text) ||
    /(在|截至|自)\s*20\d{2}\s*年?[^。\n]{0,10}(起|后|前)/.test(text);
  const hasEval = paths.some(p => /(^|[\/_\-])(eval|test|spec)([\/_\-s]|$)/i.test(p)) ||
    /评估|评测|测试用例|expected_behavior|test\s*case/i.test(text);

  const SEV_W = { high: 3, medium: 2, low: 1 };
  const qChecks = [
    {
      applies: !!descVal, pass: /什么时候|何时|使用场景|适用场景|当用户|用户说|触发|when to use|use when/i.test(descVal) && descVal.length >= 15 && !/^(帮(你|忙|助)?|协助|处理|管理数据|操作文件|does stuff|helps? with|handles? (files|data)|一个.{0,4}工具)\s*[。.，,]?$/i.test(descVal),
      severity: 'medium', effort: 'easy',
      title: '描述太笼统，AI 挑不出你',
      why: 'AI 面前摆着上百个 Skill，全靠这句 description 决定用谁。写成“帮你处理文件”这种话，等于没说——AI 根本不知道什么时候该轮到你，很可能直接跳过。',
      how: '一句话里同时讲清“做什么”和“用户说什么话时该用我”，把关键词塞进去。',
      example: 'description: 把 Excel 转成透视表和图表。当用户提到 Excel、表格、xlsx、数据透视时使用。'
    },
    {
      applies: !!descVal, pass: !/(^|[^a-z])(我可以|我会|我能|我帮|I can|I'll|I will|you can|你可以|您可以)/i.test(descVal),
      severity: 'medium', effort: 'easy',
      title: '描述别用“我/你”，要用第三人称',
      why: 'description 会被拼进系统提示里。写成“我可以帮你…”“你可以用它…”会让视角打架，反而降低 AI 识别它的成功率。官方明确要求一律第三人称。',
      how: '把“我/你”开头改成动词开头，客观陈述它“做什么”。',
      example: '把「我可以帮你处理 PDF」改成「提取 PDF 文本与表格，填写表单」'
    },
    {
      applies: handlesVisual, pass: mentionsVisualCheck,
      severity: 'high', effort: 'medium',
      title: '产出是“看得见”的东西，却没让 AI 自己看一眼',
      why: '这个 Skill 会做 PPT、图表、网页、排版这类靠肉眼判断好坏的东西。只凭脑补“应该没问题”很容易翻车——文字叠在一起、箭头错位、图片溢出，光看代码是发现不了的。',
      how: '加一步“视觉校验”：把结果渲染成图片，让 AI 看着这张图检查有没有问题，有问题就改，改好再交付。',
      example: '1) 运行 scripts/render.py out.pptx → out.png\n2) 查看 out.png：有没有文字重叠 / 错位 / 溢出\n3) 有就修，重复直到看着没问题'
    },
    {
      applies: hasCode || hasStructuredSteps, pass: hasFeedbackLoop,
      severity: 'medium', effort: 'medium',
      title: '缺一个“跑完自查、错了再改”的闭环',
      why: 'AI 一次做对不稀奇，做错也不稀奇。加一个“做完→检查→有错就回去改→再检查”的循环，能在交付前自己兜住大部分错误，质量稳很多。',
      how: '在流程末尾写明校验步骤，并规定“没通过就回到上一步重来”。',
      example: '4. 运行 validate.py 校验；\n5. 若报错，按提示修正后回到第 4 步，直到通过才算完成。'
    },
    {
      applies: mdFiles.length > 1, pass: !nestedRefs,
      severity: 'low', effort: 'medium',
      title: '文档引用套得太深了',
      why: 'AI 读被“间接”引用的文件时，常常只扫开头几行就走。让 A 指向 B、B 又指向 C，AI 很可能看不全 C 里的内容，漏掉关键信息。',
      how: '让所有参考文件都从 SKILL.md 直接一层链出，别让子文档再往下套子文档。',
      example: 'SKILL.md 里直接列：详见 FORMS.md、REFERENCE.md、EXAMPLES.md（而不是藏在 advanced.md 里）'
    },
    {
      applies: mentionsToolChoice, pass: !manyOptions,
      severity: 'low', effort: 'easy',
      title: '甩了一堆选项，却没给默认',
      why: '“可以用 A 或 B 或 C 或 D”会让 AI 犹豫、每次挑的还不一样，结果不稳定。给一个默认、再留个例外出口，AI 更省心也更一致。',
      how: '先明确“默认用 X”，只在特殊情况下才提替代方案。',
      example: '默认用 pdfplumber 提取文本；只有扫描件需要 OCR 时才改用 pdf2image。'
    },
    {
      applies: scriptContents.length > 0, pass: !hasVoodoo,
      severity: 'low', effort: 'easy',
      title: '脚本里有没解释的“魔法数字”',
      why: '脚本里冒出个 TIMEOUT = 47、RETRIES = 5，没人知道为什么是这个值。以后要调、要排错都抓瞎，AI 也无从判断该不该改。',
      how: '给这类常量补一行注释，说清为什么是这个值。',
      example: '# HTTP 请求一般 30 秒内返回，留足慢网络余量\nREQUEST_TIMEOUT = 30'
    },
    {
      applies: true, pass: !winPath,
      severity: 'medium', effort: 'easy',
      title: '路径用了反斜杠「\\」',
      why: 'scripts\\helper.py 这种 Windows 写法在 Mac / Linux 上会直接报错。正斜杠 / 到处都能用。',
      how: '把所有路径里的「\\」统一改成「/」。',
      example: '把 scripts\\helper.py 改成 scripts/helper.py'
    },
    {
      applies: true, pass: !timeSensitive,
      severity: 'low', effort: 'easy',
      title: '写了会过期的时间信息',
      why: '“2025 年 8 月前用旧接口”这类话，过了那个时间点就变成错的，还会一直误导 AI。',
      how: '正文只写“当前正确做法”；过时内容折进一个“老写法（已废弃）”的小节里留档。',
      example: '## 当前做法\n用 v2 接口…\n\n<details><summary>老写法（已废弃）</summary>v1 接口…</details>'
    },
    {
      applies: true, pass: hasEval,
      severity: 'low', effort: 'medium',
      title: '没有留一个“自测例子/评估”',
      why: '官方建议“先写评估再写文档”。哪怕只留一两个“给这样的输入、应该得到这样的结果”的例子，也能帮你和别人随时验证 Skill 有没有退化。',
      how: '加一个 evals/ 目录或一小节，写清测试输入 + 期望表现。',
      example: '输入：这份 PDF 提取全部文本存到 output.txt\n期望：不漏页、纯文本、存成 output.txt'
    },
  ];

  let qPassW = 0, qTotalW = 0;
  const qFailedLabels = [];
  qChecks.forEach(c => {
    if (!c.applies) return;
    const w = SEV_W[c.severity];
    qTotalW += w;
    if (c.pass) {
      qPassW += w;
    } else {
      qFailedLabels.push(c.title);
      problems.push({ dim: 'quality', severity: c.severity, effort: c.effort, title: c.title, why: c.why, how: c.how, example: c.example });
    }
  });
  const qApplicable = qChecks.filter(c => c.applies).length;
  const qPassed = qChecks.filter(c => c.applies && c.pass).length;
  const quality = qTotalW === 0 ? 4.0 : 1 + 4 * (qPassW / qTotalW);
  scores.quality = clamp(quality);
  evidence.quality = qTotalW === 0
    ? '没什么可挑的最佳实践项'
    : qFailedLabels.length === 0
      ? '符合全部 ' + qApplicable + ' 条适用的最佳实践，很地道'
      : '符合 ' + qPassed + '/' + qApplicable + ' 条最佳实践，最该补：' + qFailedLabels[0];

  // ---------- total + grade ----------
  let total = 0;
  DIMENSIONS.forEach(d => { total += scores[d.key] * d.weight; });
  total = Math.round(total * 100) / 100;

  let grade, gradeLabel, gradeBlurb;
  if (total >= 4.5) { grade = 'A'; gradeLabel = '很棒'; gradeBlurb = '这是个成熟好用的 Skill，稍作打磨就接近满分。'; }
  else if (total >= 3.5) { grade = 'B'; gradeLabel = '不错'; gradeBlurb = '基础扎实，补上几个小地方就能更上一层。'; }
  else if (total >= 2.5) { grade = 'C'; gradeLabel = '及格'; gradeBlurb = '能用，但有几处明显短板值得优先修。'; }
  else if (total >= 1.5) { grade = 'D'; gradeLabel = '待加强'; gradeBlurb = '骨架还不全，建议先把基础几项补齐。'; }
  else { grade = 'E'; gradeLabel = '刚起步'; gradeBlurb = '才刚开头，照着下面的建议一步步搭起来就好。'; }

  // ---------- per-dimension coaching ----------
  const coaching = {};
  DIMENSIONS.forEach(d => {
    coaching[d.key] = {
      now: evidence[d.key],
      full: FULL_MARK[d.key],
      next: nextStep(d.key, scores[d.key]),
    };
  });

  // ---------- recommendations (grouped) ----------
  const recommendations = buildRecommendations(problems, scores);

  return {
    scores, total, grade, gradeLabel, gradeBlurb,
    problems, recommendations, coaching, scan: scanData,
  };
}

const FULL_MARK = {
  structure: '有 SKILL.md + 开头元数据，脚本/资料分目录放好',
  findable: '一句话说清做什么、什么时候触发、什么不做',
  doable: '核心功能用脚本/工具实现，并写清怎么调用',
  safe: '创建/发送/删除前都会先确认，顶部还有铁律兜底',
  readable: '200 行以内，有版本号、更新日志和作者',
  quality: '描述具体到位、第三人称；看得见的产出会自检；有反馈闭环、没有反模式',
};
function nextStep(key, s) {
  const map = {
    structure: s >= 4.5 ? '已经很齐全，保持就好' : s >= 3 ? '把内容分目录、补上元数据' : '先建一个带元数据的 SKILL.md',
    findable: s >= 4.5 ? '已经很清楚' : s >= 3 ? '补上触发说法和边界' : '先写清一句话用途',
    doable: s >= 4.5 ? '已经很扎实' : s >= 3 ? '把核心步骤写成脚本' : '至少挑一步做成可运行脚本',
    safe: s >= 4.5 ? '已经很稳妥' : s >= 3 ? '给危险操作加确认' : '危险操作前必须先确认',
    readable: s >= 4.5 ? '已经很清爽' : s >= 3 ? '补版本号和作者' : '精简篇幅、补维护信息',
    quality: s >= 4.5 ? '写得很地道，保持就好' : s >= 3 ? '照“发现的问题”补上几条最佳实践' : '先把描述写具体、给产出加自检',
  };
  return map[key];
}

function buildRecommendations(problems, scores) {
  const quick = [], deep = [];
  problems.forEach(p => {
    const item = { dim: p.dim, title: p.title, how: p.how, example: p.example, effort: p.effort };
    if (p.effort === 'easy') quick.push(item);
    else deep.push(item);
  });
  return { quick, deep };
}

function clamp(v) { return Math.max(1, Math.min(5, Math.round(v * 10) / 10)); }

// ===== Render =====
function renderResult(result) {
  const { scores, total, grade, gradeLabel, gradeBlurb, problems, recommendations, coaching, scan } = result;

  // staggered fade
  $$('#result-section .card').forEach((c, i) => { c.classList.add('fade-in'); c.style.animationDelay = (i * 0.06) + 's'; });

  // score ring
  const ring = $('#score-ring');
  const circ = 2 * Math.PI * 72;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ;
  ring.style.stroke = gradeColor(grade);
  setTimeout(() => { ring.style.strokeDashoffset = circ * (1 - total / 5); }, 120);
  animateNumber($('#score-number'), 0, total, 1100);
  const gradeEl = $('#score-grade');
  gradeEl.textContent = grade;
  gradeEl.style.color = gradeColor(grade);
  $('#score-label').textContent = gradeLabel;

  // banner
  const worst = DIMENSIONS.reduce((w, d) => scores[d.key] < scores[w.key] ? d : w, DIMENSIONS[0]);
  $('#summary-banner').innerHTML = '<b>' + gradeLabel + '（' + total + '/5）</b> · ' + gradeBlurb +
    ' 最值得先改的是「' + worst.icon + ' ' + worst.name + '」，现在 ' + scores[worst.key] + ' 分。';

  // scan overview
  renderScanOverview(scan);

  // radar
  drawRadar(scores);

  // dimension coaching cards
  renderDimensions(scores, coaching);

  // problems
  renderProblems(problems);

  // recommendations
  renderRecommendations(recommendations);

  // report image — nnn illustration or canvas fallback
  const area = $('#illustration-area');
  if (illustrationAvailable) {
    area.innerHTML = '<div class="nnn-loading" id="nnn-loader"><div class="nnn-loading-spinner"></div><span>正在生成报告一览图…</span></div>';
    generateNnnIllustration(result, area);
  } else {
    area.innerHTML = '<div class="report-loading">正在生成报告图…</div>';
    generateReportImage(result).then(url => {
      area.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.title = '点击下载报告图';
      img.addEventListener('click', () => downloadDataUrl(url, 'skill-report.png'));
      area.appendChild(img);
    });
  }
}

function gradeColor(g) {
  return g === 'A' ? '#34c759' : g === 'B' ? '#30b0c7' : g === 'C' ? '#ff9f0a' : g === 'D' ? '#ff6b22' : '#ff3b30';
}

function renderScanOverview(scan) {
  const el = $('#scan-overview');
  if (!el) return;
  const cats = scan.categories;
  const chips = Object.keys(CAT_META).filter(c => cats[c].length).map(c =>
    '<div class="stat-chip cat-' + c + '"><span class="stat-icon">' + CAT_META[c].icon + '</span>' +
    '<span class="stat-num">' + cats[c].length + '</span><span class="stat-cat">' + CAT_META[c].label + '</span></div>'
  ).join('');
  el.innerHTML =
    '<div class="scan-stats">' +
      '<div class="stat-chip primary"><span class="stat-num">' + scan.totalFiles + '</span><span class="stat-cat">文件总数</span></div>' +
      '<div class="stat-chip primary"><span class="stat-num">' + scan.totalLines + '</span><span class="stat-cat">文本行数</span></div>' +
      chips +
    '</div>' +
    '<div class="tree-wrap"><div class="tree-title">📂 ' + scan.skillName + '</div><div class="file-tree">' + renderTree(scan.tree, 0) + '</div></div>';
}

function renderDimensions(scores, coaching) {
  const el = $('#dimensions-list');
  el.innerHTML = DIMENSIONS.map(d => {
    const s = scores[d.key];
    const c = coaching[d.key];
    const pct = (s / 5 * 100).toFixed(0);
    const col = barColor(s);
    return '<div class="dim-card">' +
      '<div class="dim-top">' +
        '<span class="dim-icon">' + d.icon + '</span>' +
        '<span class="dim-name">' + d.name + '</span>' +
        '<span class="dim-oneline">' + d.oneLine + '</span>' +
        '<span class="dim-score" style="color:' + col + '">' + s.toFixed(1) + '</span>' +
      '</div>' +
      '<div class="dim-bar"><div class="dim-bar-fill" style="width:' + pct + '%;background:' + col + '"></div></div>' +
      '<div class="dim-rows">' +
        '<div class="dim-row"><span class="dim-tag now">现在</span><span>' + wrapTerms(c.now) + '</span></div>' +
        '<div class="dim-row"><span class="dim-tag full">满分长这样</span><span>' + wrapTerms(c.full) + '</span></div>' +
        '<div class="dim-row"><span class="dim-tag next">下一步</span><span>' + wrapTerms(c.next) + '</span></div>' +
      '</div></div>';
  }).join('');
}

function renderProblems(problems) {
  const el = $('#diagnosis-list');
  if (!problems.length) {
    el.innerHTML = '<div class="empty-good">🎉 没发现明显问题，各方面都挺到位！</div>';
    return;
  }
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...problems].sort((a, b) => order[a.severity] - order[b.severity]);
  el.innerHTML = sorted.map(p => {
    const dim = DIMENSIONS.find(d => d.key === p.dim) || { name: '', icon: '' };
    const sev = p.severity === 'high' ? { c: 'high', t: '重要' } : p.severity === 'medium' ? { c: 'medium', t: '建议改' } : { c: 'low', t: '锦上添花' };
    return '<div class="diag-item sev-' + sev.c + '">' +
      '<div class="diag-head"><span class="diag-dim">' + dim.icon + ' ' + dim.name + '</span><span class="diag-sev sev-' + sev.c + '">' + sev.t + '</span></div>' +
      '<div class="diag-title">' + wrapTerms(p.title) + '</div>' +
      '<div class="diag-why"><b>为什么重要：</b>' + wrapTerms(p.why) + '</div>' +
      '<div class="diag-how"><b>怎么改：</b>' + wrapTerms(p.how) + '</div>' +
      (p.example ? '<pre class="diag-example">' + escapeHtml(p.example) + '</pre>' : '') +
      '</div>';
  }).join('');
}

function renderRecommendations(rec) {
  const el = $('#recommendations-list');
  let html = '';
  if (rec.quick.length) {
    html += '<div class="rec-group"><div class="rec-group-title">⚡ 几分钟就能改</div>' +
      rec.quick.map(recCard).join('') + '</div>';
  }
  if (rec.deep.length) {
    html += '<div class="rec-group"><div class="rec-group-title">🔨 值得花点时间</div>' +
      rec.deep.map(recCard).join('') + '</div>';
  }
  if (!rec.quick.length && !rec.deep.length) {
    html = '<div class="empty-good">暂无优化建议，质量很好！</div>';
  }
  el.innerHTML = html;
}
function recCard(r) {
  const dim = DIMENSIONS.find(d => d.key === r.dim) || { name: '', icon: '' };
  return '<div class="rec-item">' +
    '<div class="rec-dim">' + dim.icon + ' ' + dim.name + '</div>' +
    '<div class="rec-action">' + wrapTerms(r.title) + '</div>' +
    '<div class="rec-how">' + wrapTerms(r.how) + '</div>' +
    (r.example ? '<pre class="rec-example">' + escapeHtml(r.example) + '</pre>' : '') +
    '</div>';
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function barColor(s) {
  return s >= 4 ? '#34c759' : s >= 3 ? '#30b0c7' : s >= 2 ? '#ff9f0a' : '#ff3b30';
}

// ===== Animate number =====
function animateNumber(el, from, to, dur) {
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + (to - from) * e).toFixed(2);
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

// ===== Radar (5 dims) — DPR-aware so labels stay crisp =====
function drawRadar(scores) {
  const canvas = $('#radar-chart');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = 420;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drawRadarOn(ctx, scores, size / 2, size / 2, 118, { labels: 'full' });
}

// Reusable radar painter (also used in the report image)
function drawRadarOn(ctx, scores, cx, cy, R, opts) {
  opts = opts || {};
  const n = DIMENSIONS.length;
  const step = 2 * Math.PI / n;
  const start = -Math.PI / 2;

  // grid rings
  for (let ring = 1; ring <= 5; ring++) {
    const r = R / 5 * ring;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = start + step * i;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(60,60,67,' + (0.05 + ring * 0.012) + ')';
    ctx.lineWidth = 1; ctx.stroke();
  }
  // axes
  for (let i = 0; i < n; i++) {
    const a = start + step * i;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = 'rgba(60,60,67,0.10)'; ctx.lineWidth = 1; ctx.stroke();
  }

  const vals = DIMENSIONS.map(d => scores[d.key]);
  const pt = (i, v) => { const a = start + step * i, r = v / 5 * R; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };

  // filled polygon
  const grad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  grad.addColorStop(0, 'rgba(0,122,255,0.28)');
  grad.addColorStop(1, 'rgba(88,86,214,0.28)');
  ctx.beginPath();
  vals.forEach((v, i) => { const [x, y] = pt(i, v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(0,122,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();

  // vertex dots
  vals.forEach((v, i) => {
    const [x, y] = pt(i, v);
    ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#007aff'; ctx.stroke();
  });

  if (!opts.labels) return;

  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  DIMENSIONS.forEach((d, i) => {
    const a = start + step * i;
    const lx = cx + Math.cos(a) * (R + 34);
    const ly = cy + Math.sin(a) * (R + 30);
    const v = vals[i];
    if (opts.labels === 'icon') {
      ctx.font = '15px -apple-system,"Noto Sans SC",sans-serif';
      ctx.fillStyle = '#1d1d1f';
      ctx.fillText(d.icon, lx, ly);
      return;
    }
    // full: icon + name on one line, colored score pill below
    ctx.font = '600 13.5px -apple-system,"Noto Sans SC",sans-serif';
    ctx.fillStyle = '#1d1d1f';
    ctx.fillText(d.icon + ' ' + d.name, lx, ly - 8);
    // score pill
    const label = v.toFixed(1);
    ctx.font = '700 11px -apple-system,sans-serif';
    const pw = ctx.measureText(label).width + 14;
    const px = lx - pw / 2, py = ly + 4;
    ctx.fillStyle = hexA(barColor(v), 0.14);
    roundRect(ctx, px, py, pw, 16, 8); ctx.fill();
    ctx.fillStyle = barColor(v);
    ctx.fillText(label, lx, py + 9);
  });
}

function hexA(hex, a) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// ===== Buttons =====
$('#btn-retry').addEventListener('click', () => {
  resultSection.classList.add('hidden');
  inputSection.classList.remove('hidden');
  resetInput();
});
$('#btn-export').addEventListener('click', exportMarkdown);
$('#btn-image').addEventListener('click', () => {
  // Download the nnn illustration if available, otherwise canvas report
  const nnnImg = document.querySelector('.nnn-illustration');
  if (nnnImg && nnnImg.src) {
    const a = document.createElement('a');
    a.href = nnnImg.src;
    a.download = 'skill-health-illustration.png';
    a.click();
  } else if (currentResult) {
    generateReportImage(currentResult).then(url => downloadDataUrl(url, 'skill-report.png'));
  }
});

function downloadDataUrl(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name.replace('.png', '-' + new Date().toISOString().slice(0, 10) + '.png');
  a.click();
}

function exportMarkdown() {
  if (!currentResult) return;
  const { scores, total, grade, gradeLabel, problems, recommendations, scan } = currentResult;
  let r = '# Skill 体检报告：' + scan.skillName + '\n\n';
  r += '综合：' + total + '/5（' + grade + ' · ' + gradeLabel + '）\n\n';
  r += '## 维度评分\n\n| 维度 | 得分 |\n|---|---|\n';
  DIMENSIONS.forEach(d => { r += '| ' + d.icon + ' ' + d.name + ' | ' + scores[d.key] + ' |\n'; });
  r += '\n## 体检了什么\n\n共 ' + scan.totalFiles + ' 个文件，' + scan.totalLines + ' 行文本。\n\n';
  r += '## 发现的问题\n\n';
  problems.forEach(p => {
    r += '### ' + p.title + '\n- 为什么重要：' + p.why + '\n- 怎么改：' + p.how + (p.example ? '\n- 例子：`' + p.example.replace(/\n/g, ' ') + '`' : '') + '\n\n';
  });
  r += '## 改进清单\n\n';
  [...recommendations.quick, ...recommendations.deep].forEach(x => { r += '- ' + x.title + '：' + x.how + '\n'; });
  const blob = new Blob([r], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'skill-report-' + new Date().toISOString().slice(0, 10) + '.md';
  a.click(); URL.revokeObjectURL(url);
}

// ===== Report Image =====
// grade -> illustration tier
function tierFor(grade) {
  return (grade === 'A' || grade === 'B') ? 'great' : grade === 'C' ? 'ok' : 'fix';
}
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}
// cover-fit an image into a rounded rect
function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r); ctx.clip();
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
// word-wrap (CJK friendly) -> array of lines
function wrapText(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const ch of (text || '')) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

// async: resolves to a PNG data URL. Tries to embed the tier illustration;
// if a file:// cross-origin taint blocks toDataURL, repaints without it.
function generateReportImage(result) {
  return loadImg('assets/report-' + tierFor(result.grade) + '.png')
    .then(img => { try { return paintReport(result, img); } catch (e) { return paintReport(result, null); } })
    .catch(() => paintReport(result, null));
}

function paintReport(result, illo) {
  const { scores, total, grade, gradeLabel, gradeBlurb, problems, recommendations, coaching, scan } = result;
  const W = 900, P = 40;
  const ps = problems.slice(0, 5);
  const rs = [...recommendations.quick, ...recommendations.deep].slice(0, 5);

  // ---- section heights ----
  const headerH = 122;
  const topH = 330;     // radar (left) + dim rows (right) — fits 6 dimension rows
  const statsH = 78;
  const illoH = 196;
  const probH = 34 + (ps.length ? ps.length * 50 : 36);
  const recH = 34 + (rs.length ? rs.length * 28 : 32);
  const footerH = 52;
  const H = headerH + topH + statsH + illoH + probH + recH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#fbfbfd'); bg.addColorStop(1, '#eef0f4');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // ===== Header =====
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '600 11px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#86868b';
  ctx.fillText('SKILL 体检报告', P, 46);
  ctx.font = '700 26px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#1d1d1f';
  ctx.fillText(truncate(scan.skillName, 28), P, 80);
  ctx.font = '400 12.5px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#6e6e73';
  ctx.fillText(gradeLabel + ' · 综合 ' + total + '/5', P, 102);

  // grade pill (right)
  ctx.textAlign = 'right';
  ctx.font = '700 46px -apple-system,sans-serif';
  ctx.fillStyle = gradeColor(grade);
  ctx.fillText(grade, W - P, 84);
  ctx.font = '500 11px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#86868b';
  ctx.fillText('评级', W - P, 102);

  ctx.fillStyle = '#e3e3e8'; ctx.fillRect(P, headerH - 4, W - P * 2, 1);

  // ===== Top: radar (left) + dimension rows (right) =====
  const topY = headerH;
  // radar
  ctx.textAlign = 'left'; ctx.fillStyle = '#86868b';
  ctx.font = '600 12px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillText('五维雷达', P + 8, topY + 22);
  drawRadarOn(ctx, scores, P + 168, topY + 150, 92, { labels: 'icon' });

  // dimension rows
  const dx = 400, dw = 460;
  ctx.fillStyle = '#86868b'; ctx.textAlign = 'left';
  ctx.font = '600 12px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillText('逐项点评', dx, topY + 22);
  const rowY0 = topY + 46, rowH = 48;
  DIMENSIONS.forEach((d, i) => {
    const y = rowY0 + i * rowH, v = scores[d.key];
    ctx.font = '600 13px -apple-system,"Noto Sans SC",sans-serif';
    ctx.fillStyle = '#1d1d1f'; ctx.textAlign = 'left';
    ctx.fillText(d.icon + ' ' + d.name, dx, y);
    ctx.textAlign = 'right'; ctx.fillStyle = barColor(v);
    ctx.font = '700 13px -apple-system,sans-serif';
    ctx.fillText(v.toFixed(1), dx + dw, y);
    ctx.textAlign = 'left';
    // bar
    ctx.fillStyle = '#e5e5ea'; roundRect(ctx, dx, y + 8, dw, 6, 3); ctx.fill();
    ctx.fillStyle = barColor(v); roundRect(ctx, dx, y + 8, dw * v / 5, 6, 3); ctx.fill();
    // evidence
    ctx.font = '400 11px -apple-system,"Noto Sans SC",sans-serif';
    ctx.fillStyle = '#86868b';
    ctx.fillText(truncate((coaching[d.key] && coaching[d.key].now) || '', 38), dx, y + 28);
  });

  // ===== Scan stats chips =====
  let y = headerH + topH;
  ctx.fillStyle = '#e3e3e8'; ctx.fillRect(P, y - 8, W - P * 2, 1);
  ctx.font = '600 12px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#86868b'; ctx.textAlign = 'left';
  ctx.fillText('📂 这次扫了什么', P, y + 18);
  const chips = [
    { icon: '📁', label: scan.totalFiles + ' 个文件' },
    { icon: '📝', label: scan.textFiles + ' 个可读' },
    { icon: '📏', label: scan.totalLines + ' 行文本' },
  ];
  Object.keys(CAT_META).forEach(c => {
    const n = scan.categories[c].length;
    if (n) chips.push({ icon: CAT_META[c].icon, label: n + ' ' + CAT_META[c].label });
  });
  let cx = P, cyStat = y + 36;
  ctx.font = '500 12px -apple-system,"Noto Sans SC",sans-serif';
  ctx.textBaseline = 'middle';
  chips.forEach(ch => {
    const txt = ch.icon + ' ' + ch.label;
    const cw = ctx.measureText(txt).width + 24;
    if (cx + cw > W - P) return;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, cx, cyStat, cw, 28, 14); ctx.fill();
    ctx.strokeStyle = '#e3e3e8'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1d1d1f'; ctx.textAlign = 'left';
    ctx.fillText(txt, cx + 12, cyStat + 15);
    cx += cw + 10;
  });
  ctx.textBaseline = 'alphabetic';

  // ===== Illustration banner + conclusion =====
  y = headerH + topH + statsH;
  const illoBox = 156, iy = y + 8;
  if (illo) {
    drawCover(ctx, illo, P, iy, illoBox, illoBox, 18);
  } else {
    // placeholder tile
    const pg = ctx.createLinearGradient(P, iy, P + illoBox, iy + illoBox);
    const tint = tierFor(grade) === 'great' ? ['#d6f5e0', '#bfe8ff'] : tierFor(grade) === 'ok' ? ['#fff0d6', '#ffe3c2'] : ['#ffe0dd', '#ffd6e6'];
    pg.addColorStop(0, tint[0]); pg.addColorStop(1, tint[1]);
    ctx.fillStyle = pg; roundRect(ctx, P, iy, illoBox, illoBox, 18); ctx.fill();
    ctx.font = '60px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tierFor(grade) === 'great' ? '🎉' : tierFor(grade) === 'ok' ? '💪' : '🛠️', P + illoBox / 2, iy + illoBox / 2);
    ctx.textBaseline = 'alphabetic';
  }
  // conclusion text to the right
  const tx = P + illoBox + 28, twMax = W - P - tx;
  ctx.textAlign = 'left';
  ctx.font = '700 16px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#1d1d1f';
  ctx.fillText('体检结论', tx, iy + 26);
  ctx.font = '400 14px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#3a3a3c';
  wrapText(ctx, gradeBlurb, twMax).slice(0, 5).forEach((ln, i) => ctx.fillText(ln, tx, iy + 56 + i * 24));

  // ===== Problems =====
  y = headerH + topH + statsH + illoH;
  ctx.fillStyle = '#e3e3e8'; ctx.fillRect(P, y - 6, W - P * 2, 1);
  ctx.font = '700 13px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#ff3b30'; ctx.textAlign = 'left';
  ctx.fillText('🩺 发现的问题', P, y + 20); y += 40;
  if (!ps.length) {
    ctx.font = '400 13px -apple-system,"Noto Sans SC",sans-serif'; ctx.fillStyle = '#34c759';
    ctx.fillText('各方面都挺到位，没发现明显问题 🎉', P, y);
  }
  ps.forEach(p => {
    ctx.beginPath(); ctx.arc(P + 5, y - 5, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = p.severity === 'high' ? '#ff3b30' : p.severity === 'medium' ? '#ff9f0a' : '#30b0c7'; ctx.fill();
    ctx.font = '600 13px -apple-system,"Noto Sans SC",sans-serif'; ctx.fillStyle = '#1d1d1f';
    ctx.fillText(truncate(p.title, 38), P + 18, y);
    ctx.font = '400 11.5px -apple-system,"Noto Sans SC",sans-serif'; ctx.fillStyle = '#6e6e73';
    ctx.fillText(truncate('为什么重要：' + p.why, 56), P + 18, y + 18);
    y += 50;
  });

  // ===== Improvement checklist =====
  y = headerH + topH + statsH + illoH + probH;
  ctx.font = '700 13px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#007aff'; ctx.fillText('✅ 接下来怎么改', P, y + 20); y += 42;
  if (!rs.length) {
    ctx.font = '400 12px -apple-system,"Noto Sans SC",sans-serif'; ctx.fillStyle = '#86868b';
    ctx.fillText('暂无更多建议，继续保持～', P, y);
  }
  rs.forEach(r => {
    ctx.font = '500 12.5px -apple-system,"Noto Sans SC",sans-serif'; ctx.fillStyle = '#1d1d1f';
    ctx.fillText('☐ ' + truncate(r.title, 56), P, y); y += 28;
  });

  // ===== Footer =====
  ctx.font = '400 10px -apple-system,"Noto Sans SC",sans-serif';
  ctx.fillStyle = '#c7c7cc'; ctx.textAlign = 'center';
  ctx.fillText('Skill 体检中心 · 5 维度评分 · ' + new Date().toLocaleDateString('zh-CN'), W / 2, H - 22);

  return canvas.toDataURL('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function truncate(s, max) { s = s || ''; return s.length > max ? s.slice(0, max - 1) + '…' : s; }

// ===== nnn-illustration generation (via dev server) =====
async function generateNnnIllustration(result, area) {
  const loader = document.getElementById('nnn-loader');
  try {
    const { scores, total, grade, gradeLabel, gradeBlurb, problems, scan } = result;
    const response = await fetch('/api/generate-illustration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillName: scan.skillName,
        grade, gradeLabel, total, scores,
        problems: problems.slice(0, 5).map(p => ({
          title: p.title, severity: p.severity, dim: p.dim,
        })),
        gradeBlurb,
      }),
    });

    if (!response.ok) throw new Error('Illustration API returned ' + response.status);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    // build illustration display
    const illoDiv = document.createElement('div');
    illoDiv.className = 'nnn-illustration-wrap';

    const img = document.createElement('img');
    img.className = 'nnn-illustration';
    img.src = data.url;
    img.title = '报告一览图 — 点击下载';
    img.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = data.url;
      a.download = 'skill-health-illustration-' + grade + '.jpg';
      a.click();
    });

    const caption = document.createElement('div');
    caption.className = 'nnn-caption';
    caption.textContent = '报告一览图 · ' + gradeLabel + '（' + grade + '）· ' + (gradeBlurb || '');

    illoDiv.appendChild(img);
    illoDiv.appendChild(caption);

    // replace loader with the illustration (insert before the canvas report)
    if (loader) {
      area.replaceChild(illoDiv, loader);
    } else {
      area.insertBefore(illoDiv, area.firstChild);
    }

    // show the nnn badge
    const badge = document.getElementById('nnn-badge');
    if (badge) badge.classList.remove('hidden');
  } catch (e) {
    console.warn('nnn illustration generation failed:', e);
    // fallback to canvas report image
    area.innerHTML = '<div class="report-loading">正在生成报告图…</div>';
    generateReportImage(result).then(url => {
      area.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.title = '点击下载报告图';
      img.addEventListener('click', () => downloadDataUrl(url, 'skill-report.png'));
      area.appendChild(img);
    });
  }
}

// ===== Decorative images (graceful fallback if missing) =====
(function loadArt() {
  const setArt = (id, src) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('error', () => { const w = el.closest('.hero-art,.drop-art'); if (w) w.style.display = 'none'; });
    el.src = src;
  };
  setArt('hero-img', 'assets/hero.png');
  setArt('empty-img', 'assets/empty-upload.png');
})();
