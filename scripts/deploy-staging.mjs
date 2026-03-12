import { copyFile, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const prodConfig = path.join(root, 'wrangler.toml')
const stagingConfig = path.join(root, 'wrangler.staging.toml')
const backupConfig = path.join(root, 'wrangler.toml.__prod_backup__')
const project = process.env.CF_PAGES_STAGING_PROJECT || 'linksim-staging'

async function restoreConfigIfNeeded() {
  try {
    await rename(backupConfig, prodConfig)
  } catch {
    // no-op
  }
}

async function run() {
  await copyFile(prodConfig, backupConfig)
  await copyFile(stagingConfig, prodConfig)

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', project], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
      })
      child.on('exit', (code) => {
        if (code === 0) resolve(undefined)
        else reject(new Error(`wrangler pages deploy failed with exit code ${code ?? 'unknown'}`))
      })
      child.on('error', reject)
    })
  } finally {
    await restoreConfigIfNeeded()
  }
}

run().catch(async (err) => {
  await restoreConfigIfNeeded()
  console.error(`[deploy:staging] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
