# Swell Claude Plugins

Official Claude Code plugins for Swell. This marketplace provides AI-assisted workflows for data modeling, admin UI design, notifications, and serverless functions.

## Installation

The plugin requires [Swell CLI](https://developers.swell.is/cli/installation) to be installed and authenticated:

```bash
npm install -g @swell/cli
swell login
```

Add this marketplace to Claude Code:

```bash
/plugin marketplace add git@github.com:swellstores/swell-claude-plugins.git
```

Install the Swell Apps plugin:

```bash
/plugin install swell-app
```

The plugin updates automatically when new versions are released.

## Usage

The plugin activates automatically when working in a Swell app directory (containing `swell.json`). On session start, it initializes a `CLAUDE.md` context file. Restart Claude Code after first initialization to ensure the context loads properly.

Skills provide guided workflows with validation and safety checks. You can explicitly invoke a skill during conversation:

```
Use the swell app skill to help me create a new model
```

## Development

The `schemas/` directory contains JSON Schema definitions that validate app manifests. 
Schema changes trigger CI automation to generate TypeScript definitions (`*.d.ts`) that provide type-safe references for the AI agents. 
The Swell CLI uses these same schemas for validation.
