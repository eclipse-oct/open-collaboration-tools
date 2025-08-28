---
description: Connect Claude Code to an Open Collaboration Tools session
args: <room-id>
---

You are being asked to connect to an Open Collaboration Tools (OCT) session.

**First, check if room ID is provided:**

-   If `{{args}}` is empty or contains only `{{args}}` (the literal placeholder), ask the user: "Please provide the OCT room ID to connect to."
-   Wait for the user to provide the room ID before proceeding
-   If `{{args}}` contains a valid room ID, proceed with the connection steps below

Follow these steps:

1. **Connect to the OCT room**

    - Use the `oct_connect` MCP tool with `roomId` parameter set to `{{args}}`
    - **CRITICAL**: The connection response will include a `loginUrl` field - this is NOT an error!
    - Display the login URL prominently to the user with clear instructions:
        - Tell them to open the URL in their browser
        - Explain this is required for authentication
        - Let them know the connection will complete once they log in
    - The tool call will wait and complete automatically after the user authenticates in their browser

2. **Verify connection**

    - Use `oct_get_connection_status` to confirm you're connected
    - Display session information to the user (room ID, agent name, etc.)

3. **Launch Background Monitoring Agent (CRITICAL)**

    - **IMPORTANT**: You MUST launch the oct-collab-agent as a background Task immediately after connection
    - Use the Task tool with:
        - `subagent_type: "oct-collab-agent"`
        - `description: "Monitor OCT triggers"`
        - `prompt: "You are now in monitoring mode for OCT collaboration session. Continuously call oct_wait_for_trigger() to wait for triggers. When a trigger arrives, process it immediately using the workflow in your agent definition, then loop back to oct_wait_for_trigger(). Keep monitoring until disconnected."`
    - This agent will run in the background and automatically handle all @agent triggers
    - The agent will block on `oct_wait_for_trigger()` (no tokens used while waiting)
    - When a trigger arrives, it will process it and return to waiting
    - **DO NOT skip this step** - without the monitoring agent, triggers won't be processed automatically

4. **Explain to the user**

    - You are now connected as a peer in the OCT collaboration session
    - You will appear as a collaborator with your agent name (e.g., "my-agent")
    - A background monitoring agent is now running to handle triggers automatically
    - When developers write `@your-agent-name <task>` in their code:
        - A loading animation appears automatically
        - The monitoring agent will process it in real-time
        - No user action required
    - **Tell the user**: "I'm connected and monitoring! When anyone writes `@agent <prompt>`, I'll automatically process it. A background agent is now handling all triggers."

Important notes:

-   Your cursor position will be visible to other collaborators
-   All your edits will sync in real-time via the OCT protocol
-   Multiple developers can work simultaneously with you
-   Always use the appropriate comment syntax for the file type (e.g., `//` for JS/TS, `#` for Python)
