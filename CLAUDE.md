# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a static GitHub Pages site ("違法建築のTRPGラボ") — a collection of browser-based TRPG (tabletop RPG) tools, primarily for Call of Cthulhu (CoC) systems. No build system, bundler, or package manager is used. Files are served as-is.

## Deployment

Push to the `main` branch on GitHub. GitHub Pages deploys automatically. Jekyll is used only for the `jekyll-sitemap` plugin (configured in `_config.yml`); no templating is involved.

There are no build, lint, or test commands.

## Architecture

### Shared infrastructure (`common.css` / `common.js`)

Every page links these two files. They provide:

- **`common.css`**: Design system tokens (CSS custom properties in `:root` for dark theme, overridden by `[data-theme='light']`), and shared component styles — header, footer, modals, buttons, number spinners, animations.
- **`common.js`**: Injects the site header and footer into placeholder elements (`#site-header`, `.site-footer .container`), manages dark/light theme toggle (persisted in `localStorage`), initializes modals, and provides the custom number-spinner widget (`initNumSpinners`).

`common.js` exposes `window.IKLab` with: `openModal(id)`, `closeModal(id)`, `SITE` (site-wide URL constants), and `initNumSpinners(root?)`.

### Page structure

Each tool is a self-contained HTML file with:
- Page-specific CSS in a `<style>` block inside `<head>`
- Page-specific JS in a `<script>` block at the bottom of `<body>` (after `common.js`)
- Required placeholders for shared components:
  - `<header id="site-header"></header>` — auto-populated by `common.js`
  - `<footer class="site-footer"><div class="container"></div></footer>` — auto-populated
  - Modal overlay divs for the guide modal and any news modal (see `index.html` for reference)
- `--page-width` CSS variable on `:root` controls the header's max-width to match each page's layout

### Tool registry (`index.html`)

The homepage populates tool cards and update news from two JS arrays defined inline:
- `TOOLS` — add a new entry here to add a card to the index. Fields: `id`, `title`, `titleEn`, `icon` (Material Icons name), `desc`, `url`.
- `NEWS` — prepend a new entry to add update notices. Fields: `date`, `tag` (`NEW`/`UPDATE`/`FIX`/`INFO`), `text`.

### Design tokens

Key CSS variables (dark theme defaults in `:root`, light overrides in `[data-theme='light']`):
- Colors: `--bg`, `--bg2`, `--bg3`, `--bg-card`, `--blue`, `--cyan`, `--text`, `--text-dim`, `--text-bright`
- Borders/glow: `--border`, `--border-bright`, `--glow-blue`, `--glow-cyan`, `--glow-card`
- Fonts: `--font-main` (Noto Sans JP), `--font-mono` (Share Tech Mono), `--font-display` (Orbitron)
- Layout: `--container` (1170px), `--header-h`, `--r` (border-radius), `--t` (transition)

### Number spinner widget

Add `class="custom-spinner"` to any `input[type="number"]` and call `initNumSpinners()` (or pass a container root). `common.js` wraps the input in a `.num-wrap` div with `−`/`＋` buttons, respecting `min`/`max`/`step` attributes and dispatching `input`/`change` events. Page-level `--input-bg` and `--input-bd` CSS variables customize spinner appearance.
