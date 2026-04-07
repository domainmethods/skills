# AI Agent Skills

Custom skills for AI coding agents that extend their capabilities for marketing technology, analytics, and growth. Works with any agent that supports skills, including [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Copilot CLI, and others.

## Available Skills

| Skill | Description |
|-------|-------------|
| [martech-audit](./martech-audit/) | Martech tagging audit -- inspect a site's tag and pixel implementation (GA4, GTM, data layer, consent, ad pixels) by observing live runtime behavior |
| [seo-audit](./seo-audit/) | Technical on-page SEO audit -- inspect meta tags, headings, schema markup, canonicals, Core Web Vitals (LCP), and social sharing tags in a real browser |

## Prerequisites

- An AI coding agent that supports skills (e.g., [Claude Code](https://docs.anthropic.com/en/docs/claude-code))
- **chrome-devtools-mcp** -- Required for runtime browser inspection. Example for Claude Code:
  ```bash
  claude mcp add chrome-devtools -- npx @anthropic-ai/chrome-devtools-mcp@latest
  ```
- **Tavily MCP** -- Used for site crawling and content extraction. Get a free API key at [tavily.com](https://tavily.com). Example for Claude Code:
  ```bash
  claude mcp add -e TAVILY_API_KEY=tvly-YOUR_KEY_HERE tavily -- npx -y tavily-mcp@latest
  ```
- **Python 3.8+** -- For the deterministic checker scripts

## Installation

1. Clone this repo into your agent's skills directory. For Claude Code:
   ```bash
   mkdir -p ~/.claude/skills
   git clone https://github.com/jasonbhart/skills.git ~/.claude/skills/jasonbhart-skills
   ```

2. Symlink individual skills you want to use:
   ```bash
   ln -s ~/.claude/skills/jasonbhart-skills/martech-audit ~/.claude/skills/martech-audit
   ```

   Or copy them directly:
   ```bash
   cp -r ~/.claude/skills/jasonbhart-skills/martech-audit ~/.claude/skills/martech-audit
   ```

3. Verify the skill is detected by starting your agent -- it should appear in the skills list.

## Usage

### martech-audit

Tell your agent to audit a website:
```
audit the martech stack on example.com
```

Or use the skill directly:
```
/martech-audit example.com
```

The skill will:
1. Map the site structure via Tavily
2. Open pages in a real browser via chrome-devtools-mcp
3. Run a comprehensive JS eval to detect GTM, GA4, pixels, consent, schema, etc.
4. Run 30 deterministic checks via `check_findings.py`
5. Produce a scored report with findings, recommendations, and next steps

### seo-audit

```
audit the SEO health of example.com
```

Or use the skill directly:
```
/seo-audit example.com
```

The skill will:
1. Map the site structure via Tavily
2. Open pages in a real browser via chrome-devtools-mcp
3. Run JS evals to inspect meta tags, headings, schema, canonicals, OG tags, and more
4. Run deterministic checks via `check_seo.py`
5. Produce a scored report with findings, recommendations, and next steps

### Standalone deterministic checker

You can run the deterministic checker independently on saved eval JSON:
```bash
python martech-audit/scripts/check_findings.py --dir /path/to/eval-jsons/ --pretty
```

## Skill Structure

Each skill follows this convention:
```
skill-name/
  SKILL.md          # Main skill instructions (loaded by the agent)
  scripts/          # Supporting scripts
  references/       # Reference data (lookup tables, rubrics)
  evals/            # Eval definitions for testing
```

## License

MIT
