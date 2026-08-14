import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parse } from 'yaml'

const rootUrl = new URL('../', import.meta.url)
const packageJson = JSON.parse(
  fs.readFileSync(new URL('package.json', rootUrl), 'utf8'),
)
const workflow = parse(
  fs.readFileSync(new URL('.github/workflows/check_code.yml', rootUrl), 'utf8'),
)
const readme = fs.readFileSync(new URL('README.md', rootUrl), 'utf8')
const c2paSmoke = fs.readFileSync(
  new URL('native-tests/c2paNative.js', rootUrl),
  'utf8',
)

test('exposes read-only formatting and test scripts for CI', () => {
  assert.equal(
    packageJson.scripts['format:check'],
    'prettier --check "**/*.js"',
  )
  assert.equal(packageJson.scripts.test, 'node --test')
})

test('uses the Node built-in child_process module without a shadow package', () => {
  const runCommandSource = fs.readFileSync(
    new URL('model/runCommand.js', rootUrl),
    'utf8',
  )

  assert.match(runCommandSource, /from 'node:child_process'/)
  assert.equal(packageJson.dependencies.child_process, undefined)
})

test('allows the C2PA package to prepare its platform binding', () => {
  assert.deepEqual(packageJson.pnpm?.onlyBuiltDependencies, [
    '@contentauth/c2pa-node',
  ])
  assert.equal(
    packageJson.scripts['test:c2pa'],
    'node --test native-tests/c2paNative.js',
  )
  assert.match(c2paSmoke, /timeoutMs: 5000/)
})

test('reinstalls dependencies when updating the plugin', () => {
  assert.match(
    readme,
    /git -C \.\/plugins\/Yunzai-TomyJan-Plugin\/ pull[\s\S]*pnpm -C \.\/plugins\/Yunzai-TomyJan-Plugin\/ --ignore-workspace install --frozen-lockfile[\s\S]*pnpm -C \.\/plugins\/Yunzai-TomyJan-Plugin\/ --ignore-workspace test:c2pa/,
  )
  assert.match(
    readme,
    /pnpm -C \.\/plugins\/Yunzai-TomyJan-Plugin\/ --ignore-workspace rebuild @contentauth\/c2pa-node[\s\S]*pnpm -C \.\/plugins\/Yunzai-TomyJan-Plugin\/ --ignore-workspace test:c2pa/,
  )
})

test('runs read-only release checks for pushes and pull requests', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(workflow.on.push.branches, ['master'])
  assert.deepEqual(workflow.on.pull_request.branches, ['master'])

  const jobs = Object.values(workflow.jobs)
  const steps = jobs.flatMap((job) => job.steps)
  const commands = steps.map((step) => step.run).filter(Boolean)
  const checkoutSteps = steps.filter(
    (step) => step.uses === 'actions/checkout@v7',
  )
  const nodeSteps = steps.filter(
    (step) => step.uses === 'actions/setup-node@v7',
  )
  const testMatrix = workflow.jobs.test.strategy?.matrix?.os

  assert.ok(jobs.length >= 2)
  assert.ok(checkoutSteps.length >= 2)
  assert.ok(
    checkoutSteps.every((step) => step.with?.['persist-credentials'] === false),
  )
  assert.ok(nodeSteps.every((step) => step.with?.['node-version'] === 22))
  assert.deepEqual(testMatrix, ['ubuntu-latest', 'windows-latest'])
  assert.equal(workflow.jobs.test['runs-on'], '${{ matrix.os }}')
  assert.ok(commands.includes('pnpm install --frozen-lockfile'))
  assert.ok(commands.includes('pnpm format:check'))
  assert.ok(commands.includes('pnpm lint'))
  assert.ok(commands.includes('pnpm test:c2pa'))
  assert.ok(commands.includes('pnpm test'))
  assert.ok(!commands.includes('pnpm format'))
  assert.ok(!commands.includes('pnpm lint:fix'))
  assert.ok(!commands.some((command) => /git\s+(?:commit|push)/.test(command)))
})
