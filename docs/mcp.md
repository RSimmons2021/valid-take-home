# Catchment MCP server

Catchment's planner is also available as [MCP](https://modelcontextprotocol.io) tools, so an assistant such as Claude can plan targeting in conversation: *"plan pet-care targeting in Denver with 6 pins and give me the ZIPs"*. It runs the same pure model as the app (`app/src/model/`) over the same committed data. It needs no network and no API key.

## Tools

All tools are read-only and deterministic (`readOnlyHint`, `idempotentHint`).

| Tool | What it does |
| --- | --- |
| `list_metros` | Metros with homes, cells, and whether the county lists apartment units |
| `describe_factors` | Every factor id with its label and meaning, plus the preset business profiles |
| `plan_targeting` | Scores the metro, places pins, and returns reach, on-target share, the pins and an **`open_in_app` link** that rebuilds the plan in Catchment |
| `explain_location` | Score, verdict, the factors behind them, and real nearby places (with GERS IDs) for any lat/lon |
| `export_targeting` | `zips`, `google_radius`, `pins_csv` or `geojson` |
| `design_lift_test` | Matched-pair test/control ZIPs, balance (SMD), quality, and how to run the test |

Plan inputs are shared by all the planning tools:

| Input | Values | Default |
| --- | --- | --- |
| `metro` | metro id | (required) |
| `profile` | profile id | `home-repair` |
| `weights` | `{factor: -2…2}` (replaces the profile) | (none) |
| `pins` | 1–25 | 8 |
| `radius_mi` | 1, 1.5, 2, 3, 5 | 1.5 |
| `min_homes` | 0–500 | 25 |

Errors come back as tool errors with a fix ("Unknown factor(s): unicorns. Use describe_factors."), never as stack traces.

## Run it

```bash
cd app
npm run mcp:build          # → app/dist-mcp/catchment-mcp.js (≈34 kB; dependencies stay in node_modules)
```

**Claude Code**

```bash
claude mcp add catchment -- node /absolute/path/to/valid-take-home/app/dist-mcp/catchment-mcp.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "catchment": {
      "command": "node",
      "args": ["/absolute/path/to/valid-take-home/app/dist-mcp/catchment-mcp.js"],
      "env": { "CATCHMENT_URL": "https://your-deployment.example/" }
    }
  }
}
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `CATCHMENT_URL` | Base for the `open_in_app` links | `http://localhost:5173/` |
| `CATCHMENT_DATA` | Directory of metro files | `app/public/data` |

## Design notes

- **One model, three surfaces.** The app, the AI server and the MCP server all call the same functions (`scoreCells`, `planPins`, `plannedZips`, `bestShuffle`…). A plan from an agent is identical to the plan the app shows for the same link. A test asserts the link format.
- **Agents get links, not just numbers.** Every plan returns `open_in_app`, so a human can check an agent's work in the real interface with one click.
- **Stdout is the protocol.** Diagnostics go to stderr only.
- **Tests.** `app/mcp/mcp.test.ts` connects a real MCP client through the SDK's in-memory transport and calls every tool against the real San Francisco data.
