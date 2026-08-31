import { describe, expect, it } from 'vitest'
import creationWorkspace from './creation-workspace.css?raw'
import marketingAdvice from './marketing-advice.css?raw'
import platformCopy from './platform-copy.css?raw'
import stylesheet from './product-info.css?raw'

const roundTwoStyles = [
  stylesheet,
  marketingAdvice,
  platformCopy,
  creationWorkspace,
].join('\n')

describe('Product Information low-height layout', () => {
  it('keeps the primary submit control in document flow at desktop low height', () => {
    expect(stylesheet).toMatch(
      /@media \(max-height: 50rem\) and \(min-width: 52\.0625rem\)[\s\S]*?\.primary-action\s*\{[\s\S]*?position: static;[\s\S]*?width: 100%;/,
    )
  })
})

describe('Round 2 retro marine page contracts', () => {
  it('uses scoped semantic states for Basic controls and image removal', () => {
    expect(stylesheet).toMatch(
      /\.product-info-step \.text-control\s*\{[^}]*var\(--color-border-primary\)[^}]*var\(--color-surface-default\)[^}]*var\(--color-text-primary\)/s,
    )
    expect(stylesheet).toMatch(
      /\.product-info-step \.text-control\[aria-invalid='true'\]\s*\{[^}]*var\(--color-error-surface\)[^}]*var\(--color-error-text\)/s,
    )
    expect(stylesheet).toMatch(
      /\.product-info-step \.file-input:disabled \+ \.product-image-canvas\s*\{[^}]*var\(--color-disabled-surface\)[^}]*var\(--color-disabled-text\)/s,
    )
    expect(stylesheet).toMatch(
      /\.product-info-step \.product-image-actions \.text-action\s*\{[^}]*var\(--color-action-destructive\)/s,
    )
  })

  it('keeps Advice information, warning, and error meanings distinct', () => {
    expect(marketingAdvice).toMatch(
      /\.marketing-advice-loading\s*\{[^}]*var\(--color-info-surface\)[^}]*var\(--color-info-text\)/s,
    )
    expect(marketingAdvice).toMatch(
      /\.marketing-advice-low-confidence\s*\{[^}]*var\(--color-warning-surface\)[^}]*var\(--color-warning-text\)/s,
    )
    expect(marketingAdvice).toMatch(
      /\.marketing-advice-step--error > p\[role='alert'\]\s*\{[^}]*var\(--color-error-surface\)[^}]*var\(--color-error-text\)/s,
    )
  })

  it('distinguishes selected, disabled, invalid, and action states on Copy', () => {
    expect(platformCopy).toMatch(
      /\.option-group__option:has\(input:checked:not\(:disabled\)\)\s*\{[^}]*var\(--color-selected-surface\)[^}]*var\(--color-selected-text\)/s,
    )
    expect(platformCopy).toMatch(
      /\.option-group__option:has\(input:disabled\)\s*\{[^}]*var\(--color-disabled-surface\)[^}]*var\(--color-disabled-text\)[^}]*opacity:\s*1/s,
    )
    expect(platformCopy).toMatch(
      /\.final-copy-editor textarea\[aria-invalid='true'\]\s*\{[^}]*var\(--color-error-surface\)[^}]*var\(--color-error-text\)/s,
    )
    expect(platformCopy).toMatch(
      /\.platform-copy-navigation__next\s*\{[^}]*var\(--color-action-primary\)[^}]*var\(--color-text-inverse\)/s,
    )
  })

  it('keeps late V2 Copy overrides semantic without touching the workflow gradient', () => {
    expect(creationWorkspace).toMatch(
      /\.platform-copy-v2-loading\s*\{[^}]*var\(--color-info-surface\)[^}]*var\(--color-info-text\)/s,
    )
    expect(creationWorkspace).toMatch(
      /\.platform-copy-v2-dirty\s*\{[^}]*var\(--color-warning-surface\)[^}]*var\(--color-warning-text\)/s,
    )
    expect(creationWorkspace).toMatch(
      /\.platform-copy-v2-error\s*\{[^}]*var\(--color-error-surface\)[^}]*var\(--color-error-text\)/s,
    )
    expect(roundTwoStyles).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i)
  })

  it('introduces no raw page color or content-recoloring declaration', () => {
    const rawFunctionColor = /\b(?:rgb|rgba|hsl|hsla)\s*\(/i
    const newPageStyles = [stylesheet, marketingAdvice, platformCopy].join('\n')

    expect(newPageStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(newPageStyles).not.toMatch(rawFunctionColor)
    expect(creationWorkspace.match(/#c62828/gi)).toHaveLength(1)
    expect(roundTwoStyles).not.toMatch(
      /(?:filter|mix-blend-mode|background-blend-mode)\s*:/i,
    )
    expect(roundTwoStyles).not.toMatch(/forced-color-adjust\s*:/i)
    expect(roundTwoStyles).not.toMatch(
      /(?:^|[,{}])\s*(?:img|canvas|video|picture)\b[^{}]*\{[^}]*(?:filter|opacity|mix-blend-mode|background)/im,
    )
  })
})
