import { describe, expect, it } from 'vitest'
import components from './components.css?raw'
import creationHistory from './creation-history.css?raw'
import creationWorkspace from './creation-workspace.css?raw'
import detailEditor from './detail-editor.css?raw'
import finalResults from './final-results.css?raw'
import global from './global.css?raw'
import home from './home.css?raw'
import layout from './layout.css?raw'
import marketingAdvice from './marketing-advice.css?raw'
import marketingStrategy from './marketing-strategy.css?raw'
import platformCopy from './platform-copy.css?raw'
import posterEditor from './poster-editor.css?raw'
import posterGeneration from './poster-generation.css?raw'
import productInfo from './product-info.css?raw'
import tokens from './tokens.css?raw'

const tokenEntries = new Map(
  Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi), (match) => [
    match[1],
    match[2].trim(),
  ]),
)

const productionRuntimeStyles = [
  tokens,
  components,
  global,
  layout,
  home,
  productInfo,
  creationWorkspace,
  finalResults,
  marketingAdvice,
  platformCopy,
  posterGeneration,
  posterEditor,
  detailEditor,
  creationHistory,
  marketingStrategy,
].join('\n')

const productionRuntimeStylesWithoutTokens = [
  components,
  global,
  layout,
  home,
  productInfo,
  creationWorkspace,
  finalResults,
  marketingAdvice,
  platformCopy,
  posterGeneration,
  posterEditor,
  detailEditor,
  creationHistory,
  marketingStrategy,
].join('\n')

const legacyAliases = [
  '--color-canvas',
  '--color-ink',
  '--color-accent',
  '--border-structural',
]

function token(name: string): string | undefined {
  return tokenEntries.get(name)
}

describe('Round 1 retro marine theme contract', () => {
  it('defines the audited authoritative palette roles exactly', () => {
    const authoritative = {
      '--color-page-canvas': '#FEFEFE',
      '--color-surface-default': '#FFFFFF',
      '--color-surface-elevated': '#FFFFFF',
      '--color-surface-cream': '#FBEAD5',
      '--color-text-primary': '#073B89',
      '--color-text-secondary': '#315A9D',
      '--color-text-inverse': '#FFFFFF',
      '--color-border-primary': '#3C89C4',
      '--color-border-subtle': '#D2DCE8',
      '--color-border-strong': '#073B89',
      '--color-action-primary': '#073B89',
      '--color-action-primary-hover': '#25529B',
      '--color-action-secondary-surface': '#FFFFFF',
      '--color-action-secondary-text': '#073B89',
      '--color-action-secondary-border': '#25529B',
      '--color-focus-ring': '#25529B',
      '--color-selected-surface': '#7DDBF9',
      '--color-selected-border': '#25529B',
      '--color-disabled-border': '#D2DCE8',
      '--color-info-text': '#073B89',
      '--color-workflow-completed': '#073B89',
      '--color-workflow-current': '#62C4EC',
      '--color-workflow-future': '#FFFFFF',
      '--color-editor-selection-outline': '#62C4EC',
      '--color-editor-resize-handle': '#62C4EC',
      '--color-editor-selection-contrast': '#073B89',
      '--color-editor-selection-keyline': '#FFFFFF',
    }

    for (const [name, value] of Object.entries(authoritative)) {
      expect(token(name), name).toBe(value)
    }
  })

  it('defines the audited provisional semantic state and interaction roles', () => {
    const provisional = {
      '--color-surface-subtle': '#F4F8FC',
      '--color-text-muted': '#526B91',
      '--color-action-primary-pressed': '#052F70',
      '--color-disabled-surface': '#EEF2F7',
      '--color-disabled-text': '#596A82',
      '--color-info-surface': '#DFF5FD',
      '--color-success-surface': '#EAF5EE',
      '--color-success-text': '#1C653B',
      '--color-warning-surface': '#FFF3D6',
      '--color-warning-text': '#704600',
      '--color-error-surface': '#FDECEE',
      '--color-error-text': '#9B1C31',
      '--color-action-destructive': '#9B1C31',
      '--color-overlay': 'rgb(7 59 137 / 0.28)',
    }

    for (const [name, value] of Object.entries(provisional)) {
      expect(token(name), name).toBe(value)
    }
  })

  it('defines explicit text-on-surface, disabled workflow, focus, and global interaction tokens', () => {
    const supplemental = {
      '--color-selected-text': '#073B89',
      '--color-text-on-cyan': '#073B89',
      '--color-text-on-cream': '#073B89',
      '--color-focus-keyline': '#FFFFFF',
      '--color-workflow-completed-text': '#FFFFFF',
      '--color-workflow-current-text': '#073B89',
      '--color-workflow-future-text': '#073B89',
      '--color-workflow-disabled-surface': '#EEF2F7',
      '--color-workflow-disabled-border': '#D2DCE8',
      '--color-workflow-disabled-text': '#596A82',
      '--color-action-secondary-hover-surface': '#F4F8FC',
      '--color-action-secondary-pressed-surface': '#DFF5FD',
      '--color-link': '#25529B',
      '--color-link-hover': '#073B89',
      '--color-link-visited': '#315A9D',
      '--color-action-destructive-hover-surface': '#FDECEE',
      '--color-action-destructive-pressed-surface': '#FDECEE',
      '--color-interactive-hover-surface': '#F4F8FC',
      '--color-placeholder': '#526B91',
      '--color-selection-surface': '#7DDBF9',
      '--color-selection-text': '#073B89',
      '--color-scrollbar-thumb': '#3C89C4',
      '--color-scrollbar-thumb-hover': '#25529B',
      '--color-scrollbar-track': '#F4F8FC',
    }

    for (const [name, value] of Object.entries(supplemental)) {
      expect(token(name), name).toBe(value)
    }
  })

  it('keeps the one approved workflow gradient named and localized', () => {
    expect(token('--gradient-workflow-current')).toBe(
      'linear-gradient(90deg, #62C4EC 0%, #7DDBF9 100%)',
    )
    expect(productionRuntimeStyles.match(/--gradient-workflow-current\s*:/g)).toHaveLength(1)
    expect(productionRuntimeStyles.match(/linear-gradient\(/g)).toHaveLength(1)
    expect(layout).toMatch(
      /\.workflow-rail__item--active\s*\{[^}]*background:\s*var\(--gradient-workflow-current\)/s,
    )
    expect(
      Array.from(tokenEntries.keys()).filter((name) => name.startsWith('--gradient-')),
    ).toEqual(['--gradient-workflow-current'])
  })

  it('closes the staged migration with no legacy alias definitions or consumers', () => {
    for (const alias of legacyAliases) {
      expect(token(alias), `${alias} definition`).toBeUndefined()
      expect(productionRuntimeStyles, `${alias} consumer`).not.toContain(`var(${alias}`)
    }
  })

  it('loads shared primitives between tokens and layout', () => {
    const imports = Array.from(global.matchAll(/@import\s+['"](.+?)['"]/g), (match) => match[1])
    expect(imports.slice(0, 3)).toEqual([
      './tokens.css',
      './components.css',
      './layout.css',
    ])
  })

  it('keeps migrated shared, global, shell, and home declarations on semantic tokens', () => {
    const fullyMigrated = [components, global, layout, home].join('\n')
    expect(fullyMigrated).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(fullyMigrated).not.toContain('var(--color-accent)')
    expect(fullyMigrated).not.toContain('var(--color-ink)')
    expect(fullyMigrated).not.toContain('var(--color-canvas)')
    expect(fullyMigrated).not.toContain('var(--border-structural)')
  })

  it('moves shared action visuals out of their page geometry owners', () => {
    expect(productInfo).not.toMatch(/\.primary-action:(?:hover|active|disabled)/)
    expect(productInfo).not.toMatch(/\.text-action:(?:hover|active|disabled)/)
    expect(components).toContain('.home-button--primary')
    expect(components).toContain('.home-button--secondary')
    expect(components).toContain('.home-button.home-button--destructive')
    expect(components).toContain('.primary-action')
    expect(components).toContain('.text-action')
  })

  it('keeps workspace states and the exact V2 results border on semantic roles', () => {
    expect(creationWorkspace.match(/#c62828/gi)).toHaveLength(1)
    expect(creationWorkspace).toMatch(
      /\.platform-copy-v2-settings-error\s*\{[^}]*#c62828/s,
    )
    expect(creationWorkspace).toMatch(
      /\[data-status='stale'\][^}]+var\(--color-warning-surface\)/s,
    )
    expect(creationWorkspace).toMatch(
      /\[data-status='failed'\][^}]+var\(--color-error-surface\)/s,
    )
    expect(finalResults).toMatch(
      /\.progressive-results__section,[\s\S]*?border:\s*var\(--border-width\) solid var\(--color-border-primary\)/,
    )
    expect(finalResults).toMatch(
      /\.creation-workspace-results\s*\{[^}]*var\(--color-border-strong\)[^}]*var\(--color-surface-default\)/s,
    )
  })

  it('uses both focus keyline and outer ring without overriding forced-color behavior', () => {
    expect(global).toContain('var(--color-focus-ring)')
    expect(global).toContain('var(--color-focus-keyline)')
    expect(global).toContain('@media (forced-colors: active)')
    expect(productionRuntimeStyles).not.toMatch(/forced-color-adjust\s*:/i)
  })

  it('keeps cyan, cream, selected, and workflow surfaces paired with explicit deep text', () => {
    expect(token('--color-selected-text')).toBe(token('--color-text-primary'))
    expect(token('--color-text-on-cyan')).toBe(token('--color-text-primary'))
    expect(token('--color-text-on-cream')).toBe(token('--color-text-primary'))
    expect(token('--color-workflow-current-text')).toBe(token('--color-text-primary'))
    expect(home).toMatch(/\.home-panel--copy\s*\{[^}]*var\(--color-text-on-cream\)/s)
    expect(home).toMatch(/\.home-panel--poster\s*\{[^}]*var\(--color-selected-text\)/s)
  })

  it('keeps success, warning, error, and destructive semantics explicit and distinct', () => {
    const statePairs = [
      `${token('--color-success-surface')}/${token('--color-success-text')}`,
      `${token('--color-warning-surface')}/${token('--color-warning-text')}`,
      `${token('--color-error-surface')}/${token('--color-error-text')}`,
    ]
    expect(new Set(statePairs).size).toBe(3)
    expect(token('--color-action-destructive')).toBeDefined()
    expect(components).toContain('var(--color-action-destructive)')
  })

  it('themes the legacy strategy and final-result chrome with semantic roles', () => {
    expect(marketingStrategy).toMatch(
      /\.marketing-strategy-one-liner\s*\{[^}]*var\(--color-link\)/s,
    )
    expect(marketingStrategy).toMatch(
      /\.marketing-strategy-missing\s*\{[^}]*var\(--color-warning-text\)/s,
    )
    expect(marketingStrategy).toMatch(
      /data-strategy-status='malformed'[\s\S]*?var\(--color-error-text\)/,
    )
    expect(marketingStrategy).toMatch(
      /\.marketing-strategy-footer \.marketing-strategy-footer__next\s*\{[^}]*var\(--color-action-primary\)[^}]*var\(--color-text-inverse\)/s,
    )
    expect(finalResults).toMatch(
      /\.final-results-footer \.final-results-footer__reset\s*\{[^}]*var\(--color-action-destructive\)/s,
    )
    expect(finalResults).toMatch(
      /\.final-results-figure__preview\s*\{[^}]*var\(--color-border-primary\)[^}]*var\(--color-surface-default\)/s,
    )
  })

  it('resolves every runtime custom-property reference', () => {
    const definitions = new Set(
      Array.from(
        productionRuntimeStyles.matchAll(/(--[a-z0-9-]+)\s*:\s*[^;]+;/gi),
        (match) => match[1],
      ),
    )
    const references = new Set(
      Array.from(
        productionRuntimeStyles.matchAll(/var\(\s*(--[a-z0-9-]+)/gi),
        (match) => match[1],
      ),
    )
    const unresolved = Array.from(references).filter((name) => !definitions.has(name))
    expect(unresolved).toEqual([])
  })

  it('allows only the documented semantic error fallback outside token definitions', () => {
    const rawRuntimeColors = Array.from(
      productionRuntimeStylesWithoutTokens.matchAll(
        /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi,
      ),
      (match) => match[0].toLowerCase(),
    )
    expect(rawRuntimeColors).toEqual(['#c62828'])
    expect(creationWorkspace).toContain('var(--color-error-text, #c62828)')
  })

  it('does not introduce broad content recoloring rules', () => {
    expect(productionRuntimeStyles).not.toMatch(
      /(?:filter|mix-blend-mode|background-blend-mode)\s*:/i,
    )
    expect(global).not.toMatch(/(?:^|[,{}])\s*(?:img|canvas|video|picture|svg)\b/im)
    expect(global).not.toMatch(/forced-color-adjust\s*:/i)

    const protectedMediaRules = Array.from(
      productionRuntimeStylesWithoutTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ).filter((match) => /\b(?:img|canvas|picture|video)\b|preview|thumbnail/i.test(match[1]))
    for (const [, selector, declarations] of protectedMediaRules) {
      expect(declarations, selector).not.toMatch(
        /(?:filter|backdrop-filter|mix-blend-mode|background-blend-mode|mask(?:-image)?)\s*:/i,
      )
      expect(declarations, selector).not.toMatch(/opacity\s*:\s*(?!1(?:\D|$))[^;]+/i)
    }
  })
})
