#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// Local use with Claude Desktop, Claude Code or any MCP client that launches a command.
await createServer().connect(new StdioServerTransport());
