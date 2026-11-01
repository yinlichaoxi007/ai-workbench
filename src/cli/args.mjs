/**
 * 解析命令行参数。只接受注册表中已实现的全局选项。
 * @param {string[]} argv 原始 process.argv
 * @returns {{command: string, options: Record<string, string|boolean>, positionals: string[]}} 解析结果
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return { command: 'help', options: {}, positionals: [] };

  let command = 'help';
  let index = 0;
  if (!args[0].startsWith('-')) {
    command = args[0];
    index = 1;
  }

  const options = {};
  const positionals = [];

  for (; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--preview') options.preview = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--build') options.build = true;
    else if (arg === '--open') options.open = true;
    else if (arg === '--port') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--port 需要一个端口号');
      options.port = value;
      index += 1;
    } else if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length);
      if (!value) throw new Error('--port 需要一个端口号');
      options.port = value;
    } else if (arg === '--parity') options.parity = true;
    else if (arg === '--tool') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--tool 需要一个目标 id');
      options.tool = value;
      index += 1;
    } else if (arg.startsWith('--tool=')) {
      const value = arg.slice('--tool='.length);
      if (!value) throw new Error('--tool 需要一个目标 id');
      options.tool = value;
    } else if (arg === '--keep') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--keep 需要一个正整数');
      options.keep = value;
      index += 1;
    } else if (arg.startsWith('--keep=')) {
      const value = arg.slice('--keep='.length);
      if (!value) throw new Error('--keep 需要一个正整数');
      options.keep = value;
    } else if (arg === '--content-file') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--content-file 需要一个文件路径');
      options.contentFile = value;
      index += 1;
    } else if (arg.startsWith('--content-file=')) {
      const value = arg.slice('--content-file='.length);
      if (!value) throw new Error('--content-file 需要一个文件路径');
      options.contentFile = value;
    } else if (arg === '--root') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--root 需要一个项目父级路径');
      options.root = value;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (!value) throw new Error('--root 需要一个项目父级路径');
      options.root = value;
    } else if (arg === '--mode') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--mode 需要一个值：auto、local 或 append');
      }
      options.mode = value;
      index += 1;
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!value) throw new Error('--mode 需要一个值：auto、local 或 append');
      options.mode = value;
    } else if (arg === '--expected-hash') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--expected-hash 需要一个文件哈希');
      options.expectedFileHash = value;
      index += 1;
    } else if (arg.startsWith('--expected-hash=')) {
      const value = arg.slice('--expected-hash='.length);
      if (!value) throw new Error('--expected-hash 需要一个文件哈希');
      options.expectedFileHash = value;
    } else if (arg === '--title' || arg === '--description') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} 需要一个文本值`);
      }
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith('--title=') || arg.startsWith('--description=')) {
      const separator = arg.indexOf('=');
      const key = arg.slice(2, separator);
      const value = arg.slice(separator + 1);
      if (!value) throw new Error(`--${key} 需要一个文本值`);
      options[key] = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-V') options.version = true;
    else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
    else positionals.push(arg);
  }

  if (command === 'help' && positionals.length > 0) {
    options.topic = positionals[0];
    return { command: 'help', options, positionals: positionals.slice(1) };
  }

  return { command, options, positionals };
}
