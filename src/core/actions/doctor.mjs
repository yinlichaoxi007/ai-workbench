import fs from 'node:fs';
import path from 'node:path';
import { lintContent } from '../lib/content-checks.mjs';
import { decodeText } from '../lib/encoding.mjs';
import { checkBuild } from '../lib/entry-builder.mjs';
import { planGlobalWorkbench } from '../lib/global-workbench.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { countTextStats } from '../lib/memory-block.mjs';
import { resolvePath } from '../lib/paths.mjs';
import { inspectRecordedProject } from '../lib/projects.mjs';
import { planSkillJunctions } from '../lib/skills-junction.mjs';
import { readState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { run as runStatus } from './status.mjs';

/**
 * 运行环境、构建、目标注册表、动作对等性和漂移检查。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{parity?: boolean}} [params] 动作参数
 * @param {Array<object>} actions 动作注册表
 * @returns {Promise<{ok: boolean, checks: Array<object>}>} 检查结果
 */
export async function run(ctx, params = {}, actions = []) {
  const checks = [];

  checks.push(nodeCheck());
  checks.push(machineCheck(ctx));
  checks.push(settingsCheck(ctx));
  checks.push(buildCheck(ctx));
  checks.push(contentCheck(ctx));
  checks.push(targetsCheck(ctx));
  checks.push(memoryCheck(ctx));
  checks.push(globalCheck(ctx));
  checks.push(skillsCheck(ctx));
  checks.push(projectCheck(ctx));
  checks.push(parityCheck(ctx, actions));
  checks.push(await driftCheck(ctx));

  const selected = params.parity ? checks.filter((check) => check.id === 'parity') : checks;
  return { ok: selected.every((check) => check.status !== 'fail'), checks: selected };
}

function nodeCheck() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    id: 'node',
    title: 'Node.js 版本',
    status: major >= 20 ? 'pass' : 'fail',
    detail: `当前 ${process.version}，要求 >= 20`
  };
}

function machineCheck(ctx) {
  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    return {
      id: 'machine',
      title: '机器档案',
      status: 'pass',
      detail: `${machine.host}：${machine.filePath}`
    };
  } catch (error) {
    return { id: 'machine', title: '机器档案', status: 'fail', detail: error.message };
  }
}

function settingsCheck(ctx) {
  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    if (machine.settings.issues.length > 0) {
      return {
        id: 'settings',
        title: '本机设置',
        status: 'fail',
        detail: machine.settings.issues
          .map((issue) => `${issue.key}：${issue.message}`)
          .join('；')
      };
    }

    const envCount = Object.keys(machine.settings.env).length;
    const toolCount = Object.keys(machine.settings.tools).length;
    const customCount = Object.keys(machine.settings.customTools).length;
    return {
      id: 'settings',
      title: '本机设置',
      status: 'pass',
      detail: `备份保留 ${machine.settings.backupRetention.value} 份（${machine.settings.backupRetention.source}），GUI 端口 ${machine.settings.guiPort.value}（${machine.settings.guiPort.source}），环境变量 ${envCount} 个，工具覆盖 ${toolCount} 个，自定义工具 ${customCount} 个`
    };
  } catch (error) {
    return { id: 'settings', title: '本机设置', status: 'fail', detail: error.message };
  }
}

function buildCheck(ctx) {
  try {
    const result = checkBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
    if (result.error) {
      return {
        id: 'build',
        title: '构建产物',
        status: 'fail',
        detail: result.error
      };
    }
    return {
      id: 'build',
      title: '构建产物',
      status: result.current ? 'pass' : 'fail',
      detail: result.current
        ? `已是最新：${result.contentHash}`
        : 'dist 缺失或已过期，请运行 aiwb build'
    };
  } catch (error) {
    return { id: 'build', title: '构建产物', status: 'fail', detail: error.message };
  }
}

function contentCheck(ctx) {
  try {
    const result = lintContent(ctx.repoRoot);
    if (!result.ok) {
      return {
        id: 'content',
        title: '内容校验',
        status: 'fail',
        detail: result.errors.map((error) => error.message).join('；')
      };
    }

    return {
      id: 'content',
      title: '内容校验',
      status: 'pass',
      detail: `${result.rules.length} 条规则、${result.skills.length} 个技能${
        result.warnings.length > 0 ? `；${result.warnings.length} 个提醒` : ''
      }`
    };
  } catch (error) {
    return { id: 'content', title: '内容校验', status: 'fail', detail: error.message };
  }
}

function targetsCheck(ctx) {
  try {
    const targets = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
    const installed = targets.filter((target) => target.installed).map((target) => target.name);
    return {
      id: 'targets',
      title: '目标注册表',
      status: 'pass',
      detail: `${targets.length} 个目标；已安装：${installed.length ? installed.join('、') : '无'}`
    };
  } catch (error) {
    return { id: 'targets', title: '目标注册表', status: 'fail', detail: error.message };
  }
}

function memoryCheck(ctx) {
  try {
    const targets = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
    const memoryTargets = targets.filter((target) => target.enabled && target.entry.budget);
    if (memoryTargets.length === 0) {
      return {
        id: 'memory',
        title: '记忆注入',
        status: 'pass',
        detail: '没有启用的记忆注入目标'
      };
    }

    const over = [];
    const counts = [];
    for (const target of memoryTargets) {
      if (!fs.existsSync(target.entryPath)) continue;

      let buffer;
      let text;
      try {
        buffer = fs.readFileSync(target.entryPath);
        const decoded = decodeText(buffer);
        if (decoded.text === null) continue;
        text = decoded.text;
      } catch {
        continue;
      }

      const limit = target.entry.budget.injectLimit;
      const stats = countTextStats(text);
      const aux = `不含空白 ${stats.nonWhitespaceChars}，文件 ${buffer.length} 字节，字数 ${stats.words}`;
      counts.push(`${target.name} ${stats.chars}/${limit}（${aux}）`);
      if (stats.chars > limit) {
        over.push(
          `${target.name} 记忆文件 ${stats.chars} 字符，超过每会话注入上限 ${limit}（${aux}）`
        );
      }
    }

    if (over.length > 0) {
      return {
        id: 'memory',
        title: '记忆注入',
        status: 'pending',
        detail: `${over.join('；')}；置顶区块仍优先注入，超出上限的区块外记忆不会注入，建议精简旧记忆`
      };
    }
    if (counts.length === 0) {
      return {
        id: 'memory',
        title: '记忆注入',
        status: 'pass',
        detail: '记忆入口尚未创建，未核对'
      };
    }
    return { id: 'memory', title: '记忆注入', status: 'pass', detail: counts.join('，') };
  } catch (error) {
    return { id: 'memory', title: '记忆注入', status: 'fail', detail: error.message };
  }
}

function globalCheck(ctx) {
  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    const configuredPath = machine.paths['全局工作台'];
    if (!configuredPath) {
      return {
        id: 'global',
        title: '全局工作台',
        status: 'fail',
        detail: '机器档案缺少“全局工作台”'
      };
    }

    const plan = planGlobalWorkbench(ctx.repoRoot, resolvePath(configuredPath));
    if (plan.conflicts > 0) {
      const conflicts = [...plan.dirs, plan.link]
        .filter((entry) => entry.action === 'conflict')
        .map((entry) => `${entry.name}：${entry.reason}`);
      return { id: 'global', title: '全局工作台', status: 'fail', detail: conflicts.join('；') };
    }

    const pendingDirs = plan.dirs
      .filter((dir) => dir.action === 'create-directory')
      .map((dir) => dir.name);
    if (plan.link.action === 'create-junction' || pendingDirs.length > 0) {
      const missing = [
        ...(plan.link.action === 'create-junction' ? ['脚本 junction'] : []),
        ...pendingDirs.map((name) => `${name}/`)
      ];
      return {
        id: 'global',
        title: '全局工作台',
        status: 'pending',
        detail: `尚未安装（缺 ${missing.join('、')}），运行 aiwb deploy --apply`
      };
    }

    return {
      id: 'global',
      title: '全局工作台',
      status: 'pass',
      detail: `${plan.linkPath} → ${plan.sourceDir}`
    };
  } catch (error) {
    return { id: 'global', title: '全局工作台', status: 'fail', detail: error.message };
  }
}

function skillsCheck(ctx) {
  try {
    const plan = planSkillJunctions(ctx.repoRoot, loadTargets(ctx.repoRoot, { hostname: ctx.hostname }));
    if (plan.skills.length === 0) {
      return { id: 'skills', title: '技能 junction', status: 'pass', detail: '暂无自建技能' };
    }

    if (plan.summary.conflict > 0) {
      const conflicts = [];
      for (const tool of plan.tools) {
        if (tool.action === 'conflict') conflicts.push(`${tool.name}：${tool.reason}`);
        for (const link of tool.links) {
          if (link.action === 'conflict') {
            conflicts.push(`${tool.name}/${link.skill}：${link.reason}`);
          }
        }
      }
      return {
        id: 'skills',
        title: '技能 junction',
        status: 'fail',
        detail: conflicts.join('；')
      };
    }

    const pendingTool = plan.tools.some((tool) => tool.action === 'create-directory');
    if (plan.summary.create > 0 || pendingTool) {
      return {
        id: 'skills',
        title: '技能 junction',
        status: 'pending',
        detail: `${plan.skills.length} 个技能，${plan.summary.create} 个 junction 待创建，运行 aiwb deploy --apply`
      };
    }

    const readyTools = plan.tools.filter((tool) => tool.action === 'ready').length;
    return {
      id: 'skills',
      title: '技能 junction',
      status: 'pass',
      detail: `${plan.skills.length} 个技能已接入 ${readyTools} 个工具`
    };
  } catch (error) {
    return { id: 'skills', title: '技能 junction', status: 'fail', detail: error.message };
  }
}

function projectCheck(ctx) {
  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    const state = readState(ctx.repoRoot);
    const records = Object.entries(state.projects ?? {});
    if (records.length === 0) {
      return { id: 'projects', title: '项目挂载', status: 'pass', detail: '没有项目挂载' };
    }

    const failures = [];
    const pending = [];
    let ok = 0;
    for (const [projectPath, record] of records) {
      const project = inspectRecordedProject({
        repoRoot: ctx.repoRoot,
        machine,
        state,
        projectPath
      });
      const label = project.name || projectPath;
      if (['missing', 'missing-entry', 'missing-block', 'drift', 'malformed', 'unsupported'].includes(project.status)) {
        failures.push(`${label}：${project.label}`);
        continue;
      }
      if (project.status === 'stale') {
        pending.push(`${label}：指针待更新`);
      } else if (record.excludeAdded && !project.excludePresent) {
        pending.push(`${label}：exclude 行缺失`);
      } else if (project.tracked === true) {
        pending.push(`${label}：入口已被 git 跟踪`);
      }
      ok += 1;
    }

    if (failures.length > 0) {
      return {
        id: 'projects',
        title: '项目挂载',
        status: 'fail',
        detail: failures.join('；')
      };
    }
    if (pending.length > 0) {
      return {
        id: 'projects',
        title: '项目挂载',
        status: 'pending',
        detail: pending.join('；')
      };
    }
    return {
      id: 'projects',
      title: '项目挂载',
      status: 'pass',
      detail: `${ok} 个项目挂载正常`
    };
  } catch (error) {
    return { id: 'projects', title: '项目挂载', status: 'fail', detail: error.message };
  }
}

function parityCheck(ctx, actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      id: 'parity',
      title: 'CLI/GUI 功能对等',
      status: 'pending',
      detail: '未提供动作注册表，跳过对等性检查'
    };
  }

  const missing = [];
  for (const action of actions) {
    if (!action.cli?.command) missing.push(`${action.id}: 缺少 cli.command`);
    if (!action.gui?.page) missing.push(`${action.id}: 缺少 gui.page`);
    if (!Array.isArray(action.gui?.form)) missing.push(`${action.id}: 缺少 gui.form`);
  }

  const guiServerExists = fs.existsSync(path.join(ctx.repoRoot, 'src', 'gui', 'server.mjs'));
  let status = 'pass';
  let detail = `${actions.length} 个动作的 CLI/GUI 元数据完整`;

  if (missing.length > 0) {
    status = 'fail';
    detail = missing.join('；');
  } else if (!guiServerExists) {
    status = 'pending';
    detail += '；GUI 运行时缺失';
  }

  return { id: 'parity', title: 'CLI/GUI 功能对等', status, detail };
}

async function driftCheck(ctx) {
  try {
    const status = await runStatus(ctx);
    const drift = status.targets.filter((target) =>
      ['drift', 'drift-split'].includes(target.state)
    );
    const missingSplit = status.targets.filter((target) => target.state === 'missing-split');
    const stale = status.targets.filter((target) => target.state === 'stale');
    const problems = [...drift, ...missingSplit];
    return {
      id: 'drift',
      title: '入口漂移',
      status: problems.length > 0 ? 'fail' : 'pass',
      detail:
        problems.length > 0
          ? `${problems
              .map((target) => `${target.name}：${target.label}`)
              .join('、')}`
          : stale.length > 0
            ? `未发现手改；${stale.length} 个入口待重新部署`
            : '未发现漂移'
    };
  } catch (error) {
    return { id: 'drift', title: '入口漂移', status: 'fail', detail: error.message };
  }
}
