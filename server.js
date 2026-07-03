// ===== Skill Health Center — Dev Server =====
// Lightweight Express server that serves static files and provides
// a /api/generate-illustration endpoint to generate nnn-illustrations
// via the huamei CLI.

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Static file serving ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// --- Detect huamei CLI ---
let HUAMEI_BIN = '';
let huameiVersion = '';
try {
  HUAMEI_BIN = execSync(
    'source ~/.zshrc 2>/dev/null; source ~/.nvm/nvm.sh 2>/dev/null; which huamei',
    { shell: '/bin/zsh', encoding: 'utf-8' }
  ).trim();
  huameiVersion = execSync(
    'source ~/.zshrc 2>/dev/null; source ~/.nvm/nvm.sh 2>/dev/null; huamei --version',
    { shell: '/bin/zsh', encoding: 'utf-8' }
  ).trim();
  console.log('✅ huamei CLI found:', HUAMEI_BIN, huameiVersion);
} catch {
  console.warn('⚠️  huamei CLI not found — illustration generation will be unavailable');
}

// --- Detect nnn-illustrations skill root ---
const NNN_SKILL_ROOT = process.env.NNN_SKILL_ROOT
  || path.join(os.homedir(), '.codefuse/engine/cc/skills/nnn-illustrations');

const IP_REF_PATH = path.join(NNN_SKILL_ROOT, 'assets/alipay-ip-reference.png');
const ipRefExists = fs.existsSync(IP_REF_PATH);
if (!ipRefExists) {
  console.warn('⚠️  alipay-ip-reference.png not found at', IP_REF_PATH);
} else {
  console.log('✅ alipay-ip-reference.png found');
}

const illustrationAvailable = !!(HUAMEI_BIN && ipRefExists);

// --- Ensure output directory exists ---
const ILLUSTRATION_DIR = path.join(__dirname, 'assets/health-center-illustrations');
if (!fs.existsSync(ILLUSTRATION_DIR)) {
  fs.mkdirSync(ILLUSTRATION_DIR, { recursive: true });
}

// ===== API: Status =====
app.get('/api/status', (_req, res) => {
  res.json({
    illustrationAvailable,
    huameiVersion: huameiVersion || null,
    skillRoot: NNN_SKILL_ROOT,
  });
});

// ===== API: Generate Illustration =====
app.post('/api/generate-illustration', async (req, res) => {
  if (!illustrationAvailable) {
    return res.status(503).json({ success: false, error: 'huamei CLI not available or alipay IP reference missing' });
  }

  const data = req.body;
  if (!data.skillName || !data.grade || !data.scores) {
    return res.status(400).json({ success: false, error: 'Missing required fields: skillName, grade, scores' });
  }

  const prompt = buildIllustrationPrompt(data);
  const timestamp = Date.now();
  const filename = `report-${data.grade}-${timestamp}.jpg`;

  try {
    const { stdout } = await execFileAsync(HUAMEI_BIN, [
      'aigc', 'generate',
      '--prompt', prompt,
      '--model', 'gpt-image-2',
      '--ref', IP_REF_PATH,
      '--width', '1920',
      '--height', '1080',
      '--output-dir', ILLUSTRATION_DIR,
      '--filename', filename,
    ], {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });

    console.log('huamei stdout:', stdout);

    // Parse stdout for online URL if present
    let onlineUrl = '';
    const urlMatch = stdout.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) onlineUrl = urlMatch[0];

    const urlPath = `/assets/health-center-illustrations/${filename}`;

    res.json({
      success: true,
      localPath: path.join(ILLUSTRATION_DIR, filename),
      url: urlPath,
      onlineUrl,
      prompt,
    });
  } catch (err) {
    console.error('huamei generation failed:', err.message || err);
    res.status(500).json({
      success: false,
      error: 'Illustration generation failed',
      details: err.message || String(err),
    });
  }
});

// ===== Prompt Builder =====
function buildIllustrationPrompt(data) {
  const { skillName, grade, gradeLabel, total, scores, problems, gradeBlurb } = data;

  const dimNames = {
    structure: '骨架齐全', findable: '能被找到', doable: '能干实事',
    safe: '安全可控', readable: '好读好维护', quality: '写得地道',
  };
  const dimIcons = {
    structure: '🦴', findable: '🔍', doable: '🔧',
    safe: '🛡️', readable: '📖', quality: '✨',
  };

  // Build per-dimension score details with good/bad status
  const dimDetails = Object.entries(scores).map(([k, v]) => {
    const s = Number(v);
    const status = s >= 4 ? 'good (green)' : s >= 3 ? 'okay (teal)' : s >= 2 ? 'weak (orange)' : 'bad (red)';
    return `${dimIcons[k] || ''} ${dimNames[k]}: ${s.toFixed(1)}/5 — ${status}`;
  });
  const lowDims = Object.entries(scores)
    .filter(([, v]) => Number(v) < 3)
    .map(([k]) => dimNames[k]);

  // Find weakest dimension
  let weakestKey = Object.keys(scores)[0];
  for (const k in scores) {
    if (scores[k] < scores[weakestKey]) weakestKey = k;
  }

  // Top 3 problems for labels
  const topProblems = (problems || []).slice(0, 3).map(p => p.title);

  // Build a punchy one-line verdict
  const verdict = gradeBlurb || '';

  // Determine tier and build metaphor
  const tier = (grade === 'A' || grade === 'B') ? 'great' : grade === 'C' ? 'ok' : 'fix';

  let theme, structureType, coreIdea, composition, elements, labels;

  if (tier === 'great') {
    theme = `Skill health check report for "${skillName}": grade ${grade} (${gradeLabel}), total score ${total}/5.0. This skill is in great shape.`;
    structureType = '概念隐喻';
    coreIdea = 'A skill that passes health inspection with flying colors — solid, well-built, and reliable';
    composition = `The Alipay mascot is proudly holding up a glowing report card showing grade ${grade}. Next to it stands a sturdy, well-maintained machine with 6 round dials/gauges, all reading in the green/teal zone. The dials represent the health dimensions: ${dimDetails.join('; ')}. At the bottom or side of the image, a speech bubble or handwritten banner from the mascot says the verdict: "${verdict}". Small green checkmarks and a stethoscope rest on the machine. Everything looks solid and clean.`;
    elements = `Report card with grade ${grade} / Sturdy machine with 6 gauges all green / Green checkmarks / Speech bubble with verdict / Stethoscope`;
    labels = `${grade} ${gradeLabel} / 综合${total}/5 / ${verdict}`;
  } else if (tier === 'ok') {
    theme = `Skill health check report for "${skillName}": grade ${grade} (${gradeLabel}), total score ${total}/5.0. This skill passes but has specific weak spots needing attention.`;
    structureType = '前后对比';
    coreIdea = 'A skill that passes basic health check but has specific weak spots that need attention';
    composition = `The Alipay mascot is examining a slightly wobbly machine with a stethoscope. The machine has 6 round dials: ${dimDetails.join('; ')}. The ${lowDims.join(' and ')} dials are in orange/red zone and clearly marked with warnings. The good dials are green/teal. The mascot points at the weak dials with concern. A notepad lists the top issues. At the bottom or side of the image, a speech bubble or handwritten banner from the mascot says the verdict: "${verdict}".`;
    elements = `Wobbly machine with 6 dials (some green, some orange/red) / Stethoscope / Red warning on ${dimNames[weakestKey]} dial / Notepad with issues / Speech bubble with verdict`;
    labels = `${grade} ${gradeLabel} / 综合${total}/5 / ${dimNames[weakestKey]}偏弱 / ${topProblems[0] || '待改进'} / ${verdict}`;
  } else {
    theme = `Skill health check report for "${skillName}": grade ${grade} (${gradeLabel}), total score ${total}/5.0. This skill has significant issues that need fixing urgently.`;
    structureType = '角色状态';
    coreIdea = 'A skill with serious health problems — broken parts, warning signs, and clear issues to fix now';
    composition = `The Alipay mascot is urgently repairing a broken-down machine with a wrench. The machine has 6 round dials: ${dimDetails.join('; ')}. Multiple dials are in the red zone, especially ${dimNames[weakestKey]} which is the most broken. The red-zone dials have sparks or cracks around them, while any green dials are intact. Red warning signs are stuck on the broken parts. Scattered loose screws and broken pieces around. At the bottom or side of the image, a speech bubble or handwritten banner from the mascot says the verdict: "${verdict}".`;
    elements = `Broken machine with 6 dials (red ones cracked/sparking) / Red warning signs / Wrench and tools / Red alerts on ${lowDims.join(', ')} dials / Scattered screws / Speech bubble with verdict`;
    labels = `${grade} ${gradeLabel} / 综合${total}/5 / ${dimNames[weakestKey]}要补 / ${topProblems[0] || '问题多'} / ${verdict}`;
  }

  return `Generate one standalone 16:9 horizontal Chinese article illustration.

Visual DNA:
Pure white background. Minimalist hand-drawn line art for structures and objects. Slightly wobbly pen lines. Lots of empty white space. Sparse red/orange/blue handwritten Chinese annotations. Clean absurd product-sketch feeling. No gradients on background, no shadows, no paper texture, no complex background, no PPT infographic look, no course slide, no children's illustration, no realistic UI.

Recurring IP character required — match the reference image exactly:
Alipay official mascot (支付宝伙伴), the official Alipay companion character. NOT the old blue ant Super Ant. NOT a black blob. NOT a human in an ant suit.
Large round light-blue head with a single centered dark-blue cyclops eye and white highlight. Two small dark-blue rounded antennae on top with a small pointed tuft. Light gray/off-white hoodie with kangaroo pocket, drawstrings, and small blue circular chest logo. Dark blue/black straight pants. White four-finger gloved hands. Chunky blue-white sneakers. Clean flat 2D vector style with dark blue outlines.
The Alipay mascot must perform the core conceptual action, not decorate the scene. Friendly and optimistic but still focused on the task, not overly cute or chibi. Only one Alipay mascot in the scene.

Theme:
${theme}

Structure type:
${structureType}

Core idea:
${coreIdea}

Composition:
${composition}

Suggested elements:
${elements}

Chinese handwritten labels:
${labels}

Color use:
Alipay mascot: light-blue head #42BEFC, cyclops eye and pants #1596ED / #0269AF, hoodie #F2F2F2, dark blue outlines #233244. Black for structural line art and boxes. Orange for main flow/path/arrows. Red only for key warnings/problems/results. Blue only for secondary notes or feedback/system state.

Constraints:
One image explains only one core structure. Only one Alipay mascot with the same appearance in the scene. Keep the main subject around 40%-60% of the canvas. Preserve at least 35% blank white space. Use at most 5-8 short handwritten Chinese labels. Do not write a title in the top-left corner. Do not write the structure type on the image. Do not stretch or recolor the Alipay mascot. Do not draw it as a generic blue ant or black blob. Do not make it a formal diagram, course slide, or dense explainer. Invent a fresh visual metaphor for this specific article. Clear but not instructional, interesting but not childish, strange but clean.`;
}

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`\n🏥 Skill Health Center dev server running at http://localhost:${PORT}`);
  console.log(`   nnn illustration: ${illustrationAvailable ? '✅ available' : '❌ unavailable (huamei CLI or IP reference missing)'}\n`);
});