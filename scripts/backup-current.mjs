import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// 配置与目录边界：备份目录不能覆盖工作树、用户目录或磁盘根。
const absolutePath = z.string().min(1).refine(isAbsolute);
const databaseName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/);
const bucketSelection = z.string().default('site-images,town-maps')
  .transform(value => value.split(',').map(bucket => bucket.trim()))
  .pipe(z.array(z.enum(['site-images', 'town-maps', 'schematics'])).min(1)
    .refine(buckets => new Set(buckets).size === buckets.length));
const configuration = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  BACKUP_DIRECTORY: absolutePath,
  BACKUP_BUCKETS: bucketSelection,
  PG_DUMP_PATH: absolutePath,
  PG_RESTORE_PATH: absolutePath,
  PG_PSQL_PATH: absolutePath.optional(),
  BACKUP_VERIFY_DATABASE_URL: z.url().refine(value => /^postgres(?:ql)?:\/\//.test(value)),
  BACKUP_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  BACKUP_SUPABASE_CLI_PATH: absolutePath.optional(),
  BACKUP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(1_800_000)
});
const schemas = ['public', 'private', 'auth', 'storage', 'supabase_migrations'];
const header = Buffer.from('STBACK01');
const generationName = /^backup-[0-9a-f-]{36}$/;
const artifactName = /^(?:database\.enc|storage-metadata\.enc|objects\/[0-9]{8}\.enc)$/;

class BackupError extends Error {}
function failure(message, code) {
  const error = new BackupError(message);
  if (code) error.code = code;
  return error;
}
function within(parent, child) {
  const difference = relative(parent, child);
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`));
}

export async function validateBackupDirectory(directory, workspace = process.cwd(), home = homedir()) {
  if (!isAbsolute(directory)) throw failure('BACKUP_DIRECTORY 必须是绝对路径');
  const target = resolve(directory);
  if (target === parse(target).root || within(resolve(workspace), target) || within(target, resolve(workspace))
    || within(resolve(home), target) || within(target, resolve(home))) {
    throw failure('BACKUP_DIRECTORY 不能位于工作树、家目录或根目录');
  }
  for (let cursor = target; ; cursor = dirname(cursor)) {
    const stat = await fs.lstat(cursor).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw failure('无法核对备份目录');
    });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw failure('备份路径不能包含链接或非目录节点');
    if (cursor === dirname(cursor)) break;
  }
  return target;
}

function sign(kind, record, key) {
  return { ...record, signature: createHmac('sha256', key).update(`${kind}:${JSON.stringify(record)}`).digest('hex') };
}
function authenticate(kind, signed, key) {
  const { signature, ...record } = signed;
  const expected = sign(kind, record, key).signature;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)
    || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw failure('备份标记或 manifest 校验失败');
  }
  return record;
}
async function readRecord(path) {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_777_216) throw failure('备份记录文件无效');
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch { throw failure('备份记录文件无法解析'); }
}
async function writeRecord(path, record) {
  const file = await fs.open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
  finally { await file.close(); }
}

// 锁身份与显式恢复：只信任签名、同主机和明确不存在的 PID，不按时间回收。
const lockIdentity = z.object({ format: z.literal(1), project: z.string().regex(/^[a-f0-9]{64}$/),
  host: z.string().min(1), pid: z.number().int().positive().max(2_147_483_647), token: z.uuid() });
async function ownedLock(root, project, key) {
  const owner = authenticate('owner', await readRecord(join(root, '.backup-owner.json')), key);
  if (owner.format !== 1 || owner.project !== project) throw failure('目录属于其他项目');
  const identity = lockIdentity.safeParse(authenticate('lock', await readRecord(join(root, '.backup.lock')), key));
  if (!identity.success || identity.data.project !== project) throw failure('锁身份无效；旧空锁需停机人工核对');
  return identity.data;
}
function requireDeadProcess(identity) {
  if (identity.host !== hostname()) throw failure('跨主机锁不能在本机恢复；请到锁所属主机操作');
  try { process.kill(identity.pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') return;
    throw failure('无法确认锁进程已退出，拒绝恢复');
  }
  throw failure('锁进程仍存活（或 PID 已复用），拒绝恢复');
}
export async function inspectBackupLock(environment, { workspace = process.cwd(), home = homedir() } = {}) {
  const parsed = configuration.pick({ SUPABASE_URL: true, BACKUP_DIRECTORY: true, BACKUP_ENCRYPTION_KEY: true }).safeParse(environment);
  if (!parsed.success) throw failure('锁操作配置无效：需要 SUPABASE_URL、BACKUP_DIRECTORY、BACKUP_ENCRYPTION_KEY');
  const root = await validateBackupDirectory(parsed.data.BACKUP_DIRECTORY, workspace, home);
  const project = createHash('sha256').update(new URL(parsed.data.SUPABASE_URL).origin).digest('hex');
  const key = Buffer.from(parsed.data.BACKUP_ENCRYPTION_KEY, 'hex');
  try { return await ownedLock(root, project, key); }
  finally { key.fill(0); }
}
export async function recoverBackupLock(environment, token, options = {}) {
  if (!z.uuid().safeParse(token).success) throw failure('恢复必须显式提供锁 token');
  const identity = await inspectBackupLock(environment, options);
  if (identity.token !== token) throw failure('锁 token 已变化或不匹配，拒绝恢复');
  requireDeadProcess(identity);
  const root = resolve(environment.BACKUP_DIRECTORY);
  // 同一 token 只能恢复一次；保留标记使并发或强制终止后的恢复始终关闭失败。
  const claim = join(root, `.backup-recovery-${token}.json`);
  await writeRecord(claim, { format: 1, token, host: hostname(), pid: process.pid }).catch(error => {
    if (error.code === 'EEXIST') throw failure('该 token 已被恢复操作占用；中断恢复需停机人工核对');
    throw error;
  });
  const current = await inspectBackupLock(environment, options);
  if (JSON.stringify(current) !== JSON.stringify(identity)) throw failure('锁身份已变化，拒绝恢复');
  requireDeadProcess(current);
  await fs.unlink(join(root, '.backup.lock'));
  return identity;
}
async function acquireBackupLock(root, project, key) {
  const path = join(root, '.backup.lock');
  const file = await fs.open(path, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw failure('备份已锁定；使用 --lock-info 核对，确认退出后 --recover-lock <token>');
    throw failure('无法创建备份锁，请检查目录权限');
  });
  const identity = { format: 1, project, host: hostname(), pid: process.pid, token: randomUUID() };
  try {
    await file.writeFile(JSON.stringify(sign('lock', identity, key)));
    await file.sync();
  } catch {
    await file.close();
    throw failure('锁身份写入失败；保留锁，需停机人工核对');
  }
  return { async release() {
    try {
      const current = await ownedLock(root, project, key);
      if (JSON.stringify(current) !== JSON.stringify(identity)) throw failure('锁身份已变化，拒绝释放');
      await fs.unlink(path);
    } finally { await file.close(); }
  } };
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// CLI 输出只接受 export 字面值；其他脚本内容永不执行。
export function parseLinkedExports(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*export\s+(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=(.*?)\s*;?\s*$/.exec(line);
    if (!match) continue;
    const [, name, literal] = match;
    if (Object.hasOwn(values, name)) throw failure('linked CLI 存在重复连接字段');
    if (/^'[^']*'$/.test(literal)) values[name] = literal.slice(1, -1);
    else if (/^"(?:[^"\\$`]|\\["\\$`])*"$/.test(literal)) {
      values[name] = literal.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    } else if (/^[A-Za-z0-9_./:@%+-]+$/.test(literal)) values[name] = literal;
    else throw failure('linked CLI 连接字段不是受支持的 export 字面值');
  }
  const parsed = z.object({ PGHOST: z.string().min(1), PGPORT: z.string().regex(/^\d+$/),
    PGUSER: z.string().min(1), PGPASSWORD: z.string().min(1), PGDATABASE: databaseName }).safeParse(values);
  if (!parsed.success || Number(values.PGPORT) < 1 || Number(values.PGPORT) > 65535) {
    throw failure('linked CLI 未提供完整连接字面值');
  }
  return parsed.data;
}
function verifyConnection(value, source) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!host || !url.username || !databaseName.safeParse(database).success) throw failure('验证库 URL 或数据库名字面量无效');
  if (host === source.PGHOST.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '') && database === source.PGDATABASE) {
    throw failure('验证库不得与源使用相同 host 和 database');
  }
  for (const name of url.searchParams.keys()) if (name !== 'sslmode') throw failure('验证库 URL 仅支持 sslmode 参数');
  const sslmode = z.enum(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])
    .parse(url.searchParams.get('sslmode') ?? 'require');
  return { PGHOST: host, PGPORT: url.port || '5432', PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: sslmode };
}
function postgresEnvironment(connection) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)
    && !['BACKUP_ENCRYPTION_KEY', 'BACKUP_VERIFY_DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name)));
  return { ...environment, ...connection, PGCONNECT_TIMEOUT: '30' };
}

// 实际后端身份只在内存比较；每次恢复前重查，不输出连接或查询结果。
async function checkBackendIdentity(commandRunner, executable, source, target, timeout, expected) {
  const identities = [];
  for (const connection of [source, target]) {
    let output;
    try {
      output = await commandRunner(executable, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '--dbname', connection.PGDATABASE,
        '-v', 'VERBOSITY=sqlstate', '-c', "SELECT json_build_object('database',current_database(),'address',inet_server_addr(),'port',inet_server_port(),'system_identifier',system_identifier::text) FROM pg_catalog.pg_control_system()"], {
        environment: postgresEnvironment(connection), timeout, diagnostic: 'cluster-identity'
      });
    } catch (error) {
      const side = identities.length === 0 ? '源库' : '验证库';
      throw failure(error?.code === '42501'
        ? `${side}集群身份读取权限不足（pg_control_system）；不会自动授权`
        : `${side}集群身份查询失败；检查 psql 路径、连接及 pg_control_system 读取权限`);
    }
    let identity;
    try { identity = JSON.parse(output.trim()); } catch { throw failure('无法解析数据库后端身份'); }
    if (!identity || typeof identity !== 'object' || identity.database !== connection.PGDATABASE
      || !databaseName.safeParse(identity.database).success || typeof identity.address !== 'string'
      || !isIP(identity.address) || !Number.isInteger(identity.port) || identity.port < 1 || identity.port > 65535
      || typeof identity.system_identifier !== 'string' || !/^\d+$/.test(identity.system_identifier)) {
      throw failure('数据库后端身份不完整或不匹配');
    }
    identities.push(identity);
  }
  const [sourceIdentity, targetIdentity] = identities;
  if (sourceIdentity.system_identifier === targetIdentity.system_identifier) throw failure('验证库与源库实际集群相同，拒绝恢复');
  if (expected && identities.some((identity, index) => identity.system_identifier !== expected[index].system_identifier)) {
    throw failure('恢复前数据库集群身份已变化，拒绝恢复');
  }
  return identities;
}

async function synchronizeDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function execute(command, arguments_, { environment = process.env, timeout, input, consume, cwd, diagnostic } = {}) {
  const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([name]) =>
    !['BACKUP_ENCRYPTION_KEY', 'BACKUP_VERIFY_DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name)));
  const child = spawn(command, arguments_, { env: childEnvironment, cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let permissionDenied = false, diagnosticTail = '';
  child.stderr.on('data', chunk => {
    if (diagnostic !== 'cluster-identity') return;
    diagnosticTail = (diagnosticTail + chunk.toString()).slice(-128);
    if (/\b42501\b/.test(diagnosticTail)) permissionDenied = true;
  });
  const timer = setTimeout(() => child.kill(), timeout ?? 1_800_000);
  let output = '';
  const completion = new Promise((accept, reject) => {
    child.once('error', () => reject(failure('命令不可用，请检查可执行文件路径与权限')));
    child.once('close', code => code === 0 ? accept() : reject(permissionDenied
      ? failure('集群身份读取权限不足', '42501') : failure(`命令执行失败，退出状态 ${code ?? '终止'}`)));
  });
  const writing = input ? pipeline(input, child.stdin) : Promise.resolve(child.stdin.end());
  const reading = consume ? consume(child.stdout) : (async () => {
    for await (const chunk of child.stdout) {
      output += chunk.toString();
      if (output.length > 1_048_576) throw failure('命令输出超出限制');
    }
  })();
  try { await Promise.all([completion, writing, reading]); return output; }
  catch (error) {
    child.kill(); await Promise.allSettled([completion, writing, reading]);
    throw failure(error instanceof BackupError ? error.message : '命令启动、执行或流处理失败', error instanceof BackupError ? error.code : undefined);
  }
  finally { clearTimeout(timer); }
}
function majorVersion(output) {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(output);
  if (!match || Number(match[1]) < 17) throw failure('pg_dump/pg_restore 必须为 PostgreSQL 17 或更新版本');
  return Number(match[1]);
}

// 每个文件独立加密；项目与相对文件名绑定到 GCM 身份验证。
async function encryptFile(source, path, key, associatedData) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associatedData));
  await fs.writeFile(path, Buffer.concat([header, nonce]), { flag: 'wx', mode: 0o600 });
  await pipeline(source, cipher, createWriteStream(path, { flags: 'a', mode: 0o600 }));
  await fs.appendFile(path, cipher.getAuthTag());
  const file = await fs.open(path, 'r+');
  try { await file.sync(); } finally { await file.close(); }
}
async function decryptedFile(path, key, associatedData) {
  const file = await fs.open(path, 'r');
  let size, prefix, tag;
  try {
    size = (await file.stat()).size;
    if (size < 36) throw failure('加密归档长度无效');
    prefix = Buffer.alloc(20); tag = Buffer.alloc(16);
    await file.read(prefix, 0, 20, 0); await file.read(tag, 0, 16, size - 16);
  } finally { await file.close(); }
  if (!prefix.subarray(0, 8).equals(header)) throw failure('加密归档格式无效');
  const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(8));
  decipher.setAAD(Buffer.from(associatedData)); decipher.setAuthTag(tag);
  return Readable.from((async function* () {
    for await (const chunk of createReadStream(path, { start: 20, end: size - 17 })) yield decipher.update(chunk);
    yield decipher.final();
  })());
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function storageSnapshot(client, includedBuckets) {
  const buckets = await client.storage.listBuckets();
  if (buckets.error) throw failure('Storage bucket 列举失败');
  if (buckets.data.some(bucket => !includedBuckets.includes(bucket.id))) throw failure('发现未纳入范围的 Storage bucket');
  const objects = [];
  for (const bucket of [...buckets.data].sort((left, right) => left.id.localeCompare(right.id))) {
    const folders = [''];
    while (folders.length) {
      const prefix = folders.pop();
      for (let offset = 0; ; ) {
        const result = await client.storage.from(bucket.id).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (result.error) throw failure('Storage 对象列举失败');
        if (!result.data.length) break;
        for (const entry of result.data) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (!entry.id) folders.push(path);
          else objects.push({ bucket: bucket.id, path, id: entry.id, created_at: entry.created_at,
            updated_at: entry.updated_at, metadata: entry.metadata });
        }
        offset += result.data.length;
      }
    }
  }
  objects.sort((left, right) => `${left.bucket}/${left.path}`.localeCompare(`${right.bucket}/${right.path}`));
  return canonical({ buckets: buckets.data, objects });
}

// 只核对索引明确指向的目录；未知文件或链接会阻止删除。
async function validateGeneration(root, name, project, key) {
  if (!generationName.test(name)) throw failure('备份目录名无效');
  const directory = join(root, name);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('备份目录不可为链接');
  const signed = await readRecord(join(directory, 'manifest.json'));
  const manifest = authenticate('manifest', signed, key);
  if (manifest.project !== project || manifest.format !== 1 || manifest.verified !== true
    || !Array.isArray(manifest.files) || !manifest.files.length) throw failure('备份 manifest 身份无效');
  const names = new Set(manifest.files.map(file => file.path));
  if (names.size !== manifest.files.length || !names.has('database.enc') || !names.has('storage-metadata.enc')) throw failure('备份 manifest 文件清单无效');
  const expectedRoot = ['database.enc', 'storage-metadata.enc', 'manifest.json', 'objects'].sort();
  if (JSON.stringify((await fs.readdir(directory)).sort()) !== JSON.stringify(expectedRoot)) throw failure('备份目录存在未知节点');
  const objectStat = await fs.lstat(join(directory, 'objects'));
  if (!objectStat.isDirectory() || objectStat.isSymbolicLink()) throw failure('对象目录无效');
  const expectedObjects = [...names].filter(name_ => name_.startsWith('objects/')).map(name_ => name_.slice(8)).sort();
  if (JSON.stringify((await fs.readdir(join(directory, 'objects'))).sort()) !== JSON.stringify(expectedObjects)) throw failure('对象目录存在未知文件');
  for (const artifact of manifest.files) {
    if (!artifactName.test(artifact.path)) throw failure('备份文件路径无效');
    const path = join(directory, artifact.path);
    const artifactStat = await fs.lstat(path);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink() || artifactStat.size !== artifact.size
      || await hashFile(path) !== artifact.sha256) throw failure('备份文件 SHA256 校验失败');
  }
  return { manifest, sha256: await hashFile(join(directory, 'manifest.json')) };
}
async function removeGeneration(root, name, project, key) {
  const { manifest } = await validateGeneration(root, name, project, key);
  for (const artifact of manifest.files) await fs.unlink(join(root, name, artifact.path));
  await fs.unlink(join(root, name, 'manifest.json'));
  await fs.rmdir(join(root, name, 'objects'));
  await fs.rmdir(join(root, name));
}

export async function backupCurrent(environment, {
  workspace = process.cwd(), home = homedir(), commandRunner = execute, directorySynchronizer = synchronizeDirectory
} = {}) {
  const parsed = configuration.safeParse(environment);
  if (!parsed.success) throw failure(`备份配置无效：${[...new Set(parsed.error.issues.map(issue => issue.path[0]))].join(', ')}`);
  const config = parsed.data;
  const psqlPath = config.PG_PSQL_PATH ?? join(dirname(config.PG_DUMP_PATH), process.platform === 'win32' ? 'psql.exe' : 'psql');
  const root = await validateBackupDirectory(config.BACKUP_DIRECTORY, workspace, home);
  const project = createHash('sha256').update(new URL(config.SUPABASE_URL).origin).digest('hex');
  const key = Buffer.from(config.BACKUP_ENCRYPTION_KEY, 'hex');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const ownerPath = join(root, '.backup-owner.json');
  const ownerExists = await fs.lstat(ownerPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw failure('无法核对目录归属');
  });
  if (!ownerExists) {
    if ((await fs.readdir(root)).length) throw failure('非空目录缺少归属标记，拒绝接管');
    await writeRecord(ownerPath, sign('owner', { format: 1, project }, key));
  }
  const owner = authenticate('owner', await readRecord(ownerPath), key);
  if (owner.format !== 1 || owner.project !== project) throw failure('目录属于其他项目');
  const lock = await acquireBackupLock(root, project, key);
  const createdFiles = [];
  const stageName = `.stage-${randomUUID()}`;
  const stage = join(root, stageName);
  const nextName = `backup-${randomUUID()}`;
  const pointerPath = join(root, `.current-${randomUUID()}`);
  let stageCreated = false, nextCreated = false, published = false, phase = '核对现有备份';
  try {
    let previous = null;
    const currentExists = await fs.lstat(join(root, 'current')).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw failure('无法核对 current');
    });
    if (currentExists) {
      previous = authenticate('current', await readRecord(join(root, 'current')), key);
      if (previous.format !== 1 || previous.project !== project) throw failure('current 格式或项目归属无效');
      const checked = await validateGeneration(root, previous.directory, project, key);
      if (checked.sha256 !== previous.manifestSha256) throw failure('current manifest 摘要不符');
    }
    phase = 'PostgreSQL 客户端检查';
    const dumpVersion = majorVersion(await commandRunner(config.PG_DUMP_PATH, ['--version'], { timeout: config.BACKUP_COMMAND_TIMEOUT_MS }));
    const restoreVersion = majorVersion(await commandRunner(config.PG_RESTORE_PATH, ['--version'], { timeout: config.BACKUP_COMMAND_TIMEOUT_MS }));
    if (restoreVersion < dumpVersion) throw failure('pg_restore 版本不能低于 pg_dump');
    phase = 'linked CLI 连接解析';
    const linkedRef = (await fs.readFile(join(workspace, 'supabase', '.temp', 'project-ref'), 'utf8')).trim();
    if (!/^[a-z0-9]+$/.test(linkedRef) || new URL(config.SUPABASE_URL).hostname !== `${linkedRef}.supabase.co`) {
      throw failure('linked 项目与 SUPABASE_URL 不一致；仅支持标准 Supabase 项目域名');
    }
    const source = parseLinkedExports(await commandRunner(config.BACKUP_SUPABASE_CLI_PATH ?? 'supabase',
      ['db', 'dump', '--linked', '--dry-run'], { timeout: config.BACKUP_COMMAND_TIMEOUT_MS, cwd: workspace }));
    const target = verifyConnection(config.BACKUP_VERIFY_DATABASE_URL, source);
    phase = '备份前核对实际数据库集群身份';
    const backendIdentity = await checkBackendIdentity(commandRunner, psqlPath, { ...source, PGSSLMODE: 'require' }, target, config.BACKUP_COMMAND_TIMEOUT_MS);
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options = {}) => fetch(url, { ...options,
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.BACKUP_COMMAND_TIMEOUT_MS)])
          : AbortSignal.timeout(config.BACKUP_COMMAND_TIMEOUT_MS) }) }
    });
    phase = 'Storage 前置快照';
    const snapshot = await storageSnapshot(client, config.BACKUP_BUCKETS);
    await fs.mkdir(stage, { mode: 0o700 }); stageCreated = true;
    await fs.mkdir(join(stage, 'objects'), { mode: 0o700 });
    phase = '数据库导出';
    createdFiles.push('database.enc');
    await commandRunner(config.PG_DUMP_PATH, ['--format=custom', '--no-password', ...schemas.map(schema => `--schema=${schema}`)], {
      environment: postgresEnvironment({ ...source, PGSSLMODE: 'require' }), timeout: config.BACKUP_COMMAND_TIMEOUT_MS,
      consume: stream => encryptFile(stream, join(stage, 'database.enc'), key, `${project}:database.enc`)
    });
    phase = 'Storage 文件下载';
    for (const [index, object] of snapshot.objects.entries()) {
      const path = `objects/${String(index).padStart(8, '0')}.enc`;
      const result = await client.storage.from(object.bucket).download(object.path);
      if (result.error || !result.data) throw failure('Storage 文件下载失败');
      if (object.metadata?.size != null && Number(object.metadata.size) !== result.data.size) throw failure('Storage 文件大小变化');
      object.archive = path; createdFiles.push(path);
      await encryptFile(Readable.fromWeb(result.data.stream()), join(stage, path), key, `${project}:${path}`);
    }
    phase = '恢复前核对实际数据库后端身份';
    await checkBackendIdentity(commandRunner, psqlPath, { ...source, PGSSLMODE: 'require' }, target, config.BACKUP_COMMAND_TIMEOUT_MS, backendIdentity);
    phase = '隔离库真实恢复验证（角色、扩展或 Supabase 依赖缺失会失败）';
    await commandRunner(config.PG_RESTORE_PATH, ['--no-password', '--exit-on-error', '--single-transaction', '--clean', '--if-exists', '--no-owner', '--dbname', target.PGDATABASE], {
      environment: postgresEnvironment(target), timeout: config.BACKUP_COMMAND_TIMEOUT_MS,
      input: await decryptedFile(join(stage, 'database.enc'), key, `${project}:database.enc`)
    });
    phase = 'Storage 后置快照';
    const after = await storageSnapshot(client, config.BACKUP_BUCKETS);
    const comparison = { ...snapshot, objects: snapshot.objects.map(({ archive: _archive, ...object }) => object) };
    if (JSON.stringify(canonical(comparison)) !== JSON.stringify(after)) throw failure('Storage metadata 已变化，拒绝发布');
    createdFiles.push('storage-metadata.enc');
    await encryptFile(Readable.from([JSON.stringify(snapshot)]), join(stage, 'storage-metadata.enc'), key, `${project}:storage-metadata.enc`);
    const files = [];
    for (const path of createdFiles) files.push({ path, size: (await fs.stat(join(stage, path))).size, sha256: await hashFile(join(stage, path)) });
    createdFiles.push('manifest.json');
    await writeRecord(join(stage, 'manifest.json'), sign('manifest', { format: 1, project, createdAt: new Date().toISOString(),
      verified: true, verification: 'pg_restore --exit-on-error --single-transaction --no-owner', dumpVersion, restoreVersion, schemas, files }, key));
    phase = '发布 current';
    await fs.rename(stage, join(root, nextName)); nextCreated = true; stageCreated = false;
    const verified = await validateGeneration(root, nextName, project, key);
    await writeRecord(pointerPath, sign('current', { format: 1, project, directory: nextName, manifestSha256: verified.sha256 }, key));
    await fs.rename(pointerPath, join(root, 'current')); published = true;
    phase = '同步已发布 current 的父目录';
    try {
      await directorySynchronizer(join(root, nextName, 'objects'));
      await directorySynchronizer(join(root, nextName));
      await directorySynchronizer(root);
    } catch {
      throw failure(`新 current 已发布，但无法同步目录；${previous ? '旧副本仍保留' : '未删除任何旧副本'}，拒绝清理（Windows 可能不支持目录 fsync）`);
    }
    if (previous) {
      phase = '清理已匹配 manifest 的上一份备份';
      await removeGeneration(root, previous.directory, project, key);
    }
    return { verified: true, directory: root, objects: snapshot.objects.length };
  } catch (error) {
    const detail = error instanceof BackupError ? error.message : '依赖、网络或文件操作失败';
    throw failure(published ? `新 current 已发布；${phase}失败，旧副本可能仍在；${detail}`
      : `备份失败：${phase}；旧 current 未替换；${detail}`);
  } finally {
    try {
      await fs.unlink(pointerPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (nextCreated && !published) await removeGeneration(root, nextName, project, key);
      if (stageCreated) {
        for (const path of createdFiles) await fs.unlink(join(stage, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fs.rmdir(join(stage, 'objects')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fs.rmdir(stage);
      }
    } finally {
      try { await lock.release(); } finally { key.fill(0); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length === 1 && arguments_[0] === '--lock-info') {
      console.log(JSON.stringify(await inspectBackupLock(process.env)));
    } else if (arguments_.length === 2 && arguments_[0] === '--recover-lock') {
      await recoverBackupLock(process.env, arguments_[1]);
      console.log('残留锁已恢复；未更改 current、归档或暂存目录');
    } else if (!arguments_.length) {
      const result = await backupCurrent(process.env);
      console.log(`备份已验证并发布：${result.objects} 个 Storage 对象；current 为索引文件`);
    } else throw failure('参数无效：支持 --lock-info 或 --recover-lock <token>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
