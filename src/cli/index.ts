#!/usr/bin/env node
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from '../audit'
import { renderCard } from '../card'
import { formatReport } from '../formatter'
import { parseSinceDuration } from '../session/discover'

const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts')

function loadFonts() {
  return {
    regular: readFileSync(resolve(FONT_DIR, 'JetBrainsMono-Regular.ttf')),
    bold: readFileSync(resolve(FONT_DIR, 'JetBrainsMono-Bold.ttf')),
  }
}

type Args = {
  since: string
  project?: string
  share: boolean
  out: string
  json: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { since: '7d', share: false, out: 'ccaudit.png', json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--since' && i + 1 < argv.length) {
      args.since = argv[++i]
    } else if (a === '--project' && i + 1 < argv.length) {
      args.project = argv[++i]
    } else if (a === '--share') {
      args.share = true
    } else if (a === '--out' && i + 1 < argv.length) {
      args.out = argv[++i]
    } else if (a === '--json') {
      args.json = true
    } else if (a === '--help' || a === '-h') {
      args.help = true
    }
  }
  return args
}

function printHelp(): void {
  console.log(`ccaudit — find where your Claude Code tokens were wasted

Usage:
  npx ccaudit [options]

Options:
  --since <dur>     Time window (e.g. 7d, 24h, 30m). Default: 7d
  --project <name>  Filter by project slug substring
  --share           Write a shareable 1200x630 PNG (default: ./ccaudit.png)
  --out <path>      Output path for --share. Default: ./ccaudit.png
  --json            Emit structured JSON instead of formatted text
  --help, -h        Show this message

Data stays local. Reads ~/.claude/projects/*/*.jsonl only.
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  let since: Date
  try {
    since = parseSinceDuration(args.since)
  } catch (err) {
    console.error(`ccaudit: ${(err as Error).message}`)
    process.exitCode = 1
    return
  }

  const report = audit({ since, projectFilter: args.project })

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(formatReport(report))

  if (args.share) {
    if (report.sessionCount === 0) {
      console.error('\nccaudit: nothing to share — no sessions in window.')
      process.exitCode = 1
      return
    }
    const outPath = resolve(args.out)
    try {
      const existing = lstatSync(outPath, { throwIfNoEntry: false })
      if (existing?.isSymbolicLink()) {
        console.error(`\nccaudit: refusing to write through a symlink at ${outPath}`)
        process.exitCode = 1
        return
      }
      mkdirSync(dirname(outPath), { recursive: true })
      const png = await renderCard(report, loadFonts())
      writeFileSync(outPath, png)
      console.log(`\nccaudit: wrote shareable card → ${outPath}`)
    } catch (err) {
      console.error(`\nccaudit: failed to render card — ${(err as Error).message}`)
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  console.error(`ccaudit: ${(err as Error).message}`)
  process.exitCode = 1
})
