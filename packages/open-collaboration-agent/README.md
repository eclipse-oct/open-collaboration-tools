# Open Collaboration Agent

## Setup

1. Build the project and go to `packages/open-collaboration-agent`

2. Create a `.env` file with variables `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` (the .env file is auto-loaded by the CLI)

3. Create a collaboration session in a workspace of your choice and copy the room id

4. Call `./bin/agent -r {room id}` (optionally add `-m {model id}` to choose a different LLM – the default is currently `claude-3-5-sonnet-latest`)

5. Open the login URL and use the simple login (choose something like `agent` as username)

6. In your host workspace, allow the agent user to enter the session

## Usage

1. Open a file of your choice and try requesting a change: write a line starting with `@agent` (or whatever username you have given it, prefixed with `@`) and then a prompt, optionally in a comment.

   Example: `// @agent Write a factorial function`

2. To start the agent, hit enter at the end of that line and wait... ✨