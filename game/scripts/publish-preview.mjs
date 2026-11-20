// Preview channel without repo bloat (plan T0.11, decision D5).
// Build -> temp folder -> noindex/robots/.nojekyll -> `git init` -> ONE orphan commit "preview <buildId>"
// -> (only with --push) `git push --force` to the separate preview repo. The main repo's git state is never touched.
// CLI: node scripts/publish-preview.mjs [--skip-build] [--push] [--dist dist] [--out <dir>] [--remote <url>]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..') // G:
const DEFAULT_REMOTE = 'https://github.com/voaneves/timeline-preview.git'
const ROBOTS_META = '<meta name="robots" content="noindex,nofollow">'
const ROBOTS_RE = /<meta\s+name=["']robots["'][^>]*>/i

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }

const distDir = resolve(ROOT, option('--dist', 'dist'))
const outDir = resolve(option('--out', join(tmpdir(), 'timeline-preview-publish'))) // fixed path = idempotent
const remote = option('--remote', DEFAULT_REMOTE)

// Clean env so a parent GIT_DIR / GIT_WORK_TREE can never redirect git into another repo.
const cleanEnv = { ...process.env }
for(const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'])
    delete cleanEnv[key]

function run(_cmd, _args, _cwd, _opts = {})
{
    const result = spawnSync(_cmd, _args, { cwd: _cwd, env: cleanEnv, encoding: 'utf8', stdio: _opts.inherit ? 'inherit' : 'pipe', shell: _opts.shell ?? false })
    if(result.status !== 0)
        throw new Error(`${_cmd} ${_args.join(' ')} failed (${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`)
    return (result.stdout ?? '').trim()
}

// Source HTML must carry the robots meta too, so even a direct deploy stays noindex.
function ensureSourceRobots()
{
    const file = join(ROOT, 'sources', 'index.html')
    if(!existsSync(file))
        return
    const html = readFileSync(file, 'utf8')
    if(ROBOTS_RE.test(html))
        return
    writeFileSync(file, html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${ROBOTS_META}`))
    console.log('Added robots meta to sources/index.html')
}

function injectNoindex(_html)
{
    if(ROBOTS_RE.test(_html))
        return _html.replace(ROBOTS_RE, ROBOTS_META)
    return _html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${ROBOTS_META}`)
}

function walkHtml(_dir, _out = [])
{
    for(const entry of readdirSync(_dir, { withFileTypes: true }))
    {
        const full = join(_dir, entry.name)
        if(entry.isDirectory())
            walkHtml(full, _out)
        else if(/\.html?$/i.test(entry.name))
            _out.push(full)
    }
    return _out
}

ensureSourceRobots()

if(!flag('--skip-build'))
{
    console.log('Building (npm run build)...')
    run('npm run build', [], ROOT, { inherit: true, shell: true })
}

if(!existsSync(join(distDir, 'index.html')))
    throw new Error(`No build at ${distDir}. Run without --skip-build.`)

const manifests = readdirSync(distDir).filter((n) => /^asset-manifest\.[^.]+\.json$/.test(n)).sort()
if(!manifests.length)
    throw new Error('No asset-manifest.<buildId>.json in dist')
const buildId = JSON.parse(readFileSync(join(distDir, manifests[manifests.length - 1]), 'utf8')).buildId

// Fresh temp folder every time (idempotent, also clears any previous .git).
rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
mkdirSync(outDir, { recursive: true })
cpSync(distDir, outDir, { recursive: true })

for(const file of walkHtml(outDir))
    writeFileSync(file, injectNoindex(readFileSync(file, 'utf8')))
writeFileSync(join(outDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
writeFileSync(join(outDir, '.nojekyll'), '')
writeFileSync(join(outDir, 'LICENSES.md'), readFileSync(join(ROOT, 'LICENSES.md')))

const name = run('git', ['config', 'user.name'], ROOT)
const email = run('git', ['config', 'user.email'], ROOT)
const git = (...a) => run('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...a], outDir)
git('init', '-q', '-b', 'main')
git('add', '-A')
git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--no-verify', '-m', `preview ${buildId}`)
const sha = git('rev-parse', '--short', 'HEAD')

console.log(`\nPreview folder: ${outDir}`)
console.log(`Commit: ${sha} "preview ${buildId}" (orphan, single commit)`)

if(flag('--push'))
{
    console.log(`Pushing (force) to ${remote} main...`)
    git('push', '--force', remote, 'HEAD:main')
    console.log('Pushed.')
}
else
{
    console.log('\nNot pushed. To publish:')
    console.log(`  git -C "${outDir}" push --force ${remote} HEAD:main`)
    console.log('  (or re-run with --push)')
}
